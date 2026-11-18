/**
 * Reminder schedule math: expand offsets (days relative to due date) into UTC instants,
 * DST-aware, using Intl (no external deps). Full validation + expansion tests land in Phase 4;
 * this module establishes the contract and a conservative implementation.
 */

export interface ScheduleStep {
  /** Offset in days from the invoice due date. Negative = before due, positive = after. */
  readonly days: number;
}

export interface ReminderScheduleDef {
  readonly offsets: readonly ScheduleStep[];
  /** Local wall-clock time reminders fire at, in the organization timezone, "HH:mm". */
  readonly sendAtLocalTime: string;
}

export const SCHEDULE_LIMITS = {
  minDays: -14,
  maxDays: 90,
  maxSteps: 8,
} as const;

export type ScheduleValidationIssue =
  | { code: "EMPTY" }
  | { code: "TOO_MANY_STEPS"; count: number }
  | { code: "DAY_OUT_OF_RANGE"; days: number }
  | { code: "DUPLICATE_DAY"; days: number }
  | { code: "BAD_TIME"; value: string };

export function validateSchedule(def: ReminderScheduleDef): readonly ScheduleValidationIssue[] {
  const issues: ScheduleValidationIssue[] = [];
  if (def.offsets.length === 0) issues.push({ code: "EMPTY" });
  if (def.offsets.length > SCHEDULE_LIMITS.maxSteps)
    issues.push({ code: "TOO_MANY_STEPS", count: def.offsets.length });
  const seen = new Set<number>();
  for (const step of def.offsets) {
    if (!Number.isInteger(step.days) || step.days < SCHEDULE_LIMITS.minDays || step.days > SCHEDULE_LIMITS.maxDays) {
      issues.push({ code: "DAY_OUT_OF_RANGE", days: step.days });
    }
    if (seen.has(step.days)) issues.push({ code: "DUPLICATE_DAY", days: step.days });
    seen.add(step.days);
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(def.sendAtLocalTime)) {
    issues.push({ code: "BAD_TIME", value: def.sendAtLocalTime });
  }
  return issues;
}

/** Whole-day shift on a YYYY-MM-DD date string, calendar-correct via UTC arithmetic. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new RangeError(`invalid ISO date: ${isoDate}`);
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const shifted = new Date(base + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Convert a target local wall-clock ("YYYY-MM-DD HH:mm") in `timeZone` to a UTC epoch ms.
 * Iterative tzOffset correction converges in ≤2 passes and is DST-safe for whole-hour
 * and half-hour zones. Ambiguous times (fall-back hour) resolve to the earlier offset.
 */
export function zonedTimeToUtc(dateIso: string, hhmm: string, timeZone: string): number {
  const [hStr, minStr] = hhmm.split(":");
  const hour = Number(hStr);
  const minute = Number(minStr);
  const [yStr, moStr, dStr] = dateIso.split("-");
  const guess = Date.UTC(Number(yStr), Number(moStr) - 1, Number(dStr), hour, minute);
  let ts = guess;
  for (let i = 0; i < 3; i++) {
    const offsetMs = tzOffsetMs(new Date(ts), timeZone);
    const desired = guess - offsetMs;
    if (desired === ts) break;
    ts = desired;
  }
  return ts;
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour"), at("minute"), at("second"));
  return asUtc - instant.getTime();
}

/** Expand a schedule against an invoice due date into ordered UTC instants (epoch ms). */
export function expandSchedule(
  def: ReminderScheduleDef,
  dueDateIso: string,
  timeZone: string,
): readonly { stepIndex: number; scheduledForUtcMs: number }[] {
  const issues = validateSchedule(def);
  if (issues.length > 0) {
    throw new Error(`INVALID_SCHEDULE: ${JSON.stringify(issues)}`);
  }
  return def.offsets.map((step, stepIndex) => ({
    stepIndex,
    scheduledForUtcMs: zonedTimeToUtc(shiftIsoDate(dueDateIso, step.days), def.sendAtLocalTime, timeZone),
  }));
}
