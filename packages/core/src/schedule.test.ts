import { describe, expect, it } from "vitest";
import {
  expandSchedule,
  shiftIsoDate,
  validateSchedule,
  zonedTimeToUtc,
  type ReminderScheduleDef,
} from "../src/schedule";

const standard: ReminderScheduleDef = {
  offsets: [{ days: -3 }, { days: 0 }, { days: 7 }],
  sendAtLocalTime: "09:00",
};

describe("validateSchedule", () => {
  it("accepts a well-formed schedule", () => {
    expect(validateSchedule(standard)).toEqual([]);
  });
  it("rejects empty, duplicates, out-of-range and >8 steps", () => {
    expect(validateSchedule({ offsets: [], sendAtLocalTime: "09:00" })).toContainEqual({
      code: "EMPTY",
    });
    expect(
      validateSchedule({ offsets: [{ days: 1 }, { days: 1 }], sendAtLocalTime: "09:00" }),
    ).toContainEqual({ code: "DUPLICATE_DAY", days: 1 });
    expect(validateSchedule({ offsets: [{ days: 91 }], sendAtLocalTime: "09:00" })).toContainEqual({
      code: "DAY_OUT_OF_RANGE",
      days: 91,
    });
    const nine = Array.from({ length: 9 }, (_, i) => ({ days: i + 1 }));
    expect(validateSchedule({ offsets: nine, sendAtLocalTime: "09:00" })).toContainEqual({
      code: "TOO_MANY_STEPS",
      count: 9,
    });
  });
  it("rejects malformed local times", () => {
    expect(validateSchedule({ offsets: [{ days: 0 }], sendAtLocalTime: "24:00" })).toContainEqual({
      code: "BAD_TIME",
      value: "24:00",
    });
  });
});

describe("shiftIsoDate", () => {
  it("shifts across month/year boundaries calendar-correctly", () => {
    expect(shiftIsoDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDate("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("throws on invalid dates", () => {
    expect(() => shiftIsoDate("2026-13-01", 0)).toThrow(RangeError);
  });
});

describe("zonedTimeToUtc (DST behaviour)", () => {
  it("resolves standard-time instants", () => {
    // Bucharest is EET (UTC+2) in January
    expect(zonedTimeToUtc("2026-01-15", "09:00", "Europe/Bucharest")).toBe(
      Date.UTC(2026, 0, 15, 7, 0),
    );
  });
  it("resolves summer-time instants", () => {
    // Bucharest is EEST (UTC+3) in July
    expect(zonedTimeToUtc("2026-07-15", "09:00", "Europe/Bucharest")).toBe(
      Date.UTC(2026, 6, 15, 6, 0),
    );
  });
  it("handles the EU spring-forward day without drifting by an hour", () => {
    // 2026-03-29: clocks jump 03:00→04:00 in Europe/Bucharest. 09:00 exists → UTC+3 applies.
    expect(zonedTimeToUtc("2026-03-29", "09:00", "Europe/Bucharest")).toBe(
      Date.UTC(2026, 2, 29, 6, 0),
    );
    // Day before still winter time
    expect(zonedTimeToUtc("2026-03-28", "09:00", "Europe/Bucharest")).toBe(
      Date.UTC(2026, 2, 28, 7, 0),
    );
  });
  it("supports half-hour zones", () => {
    // Europe/Dublin +00:00 winter; Asia/Kolkata +05:30 always
    expect(zonedTimeToUtc("2026-01-10", "09:00", "Asia/Kolkata")).toBe(
      Date.UTC(2026, 0, 10, 3, 30),
    );
  });
});

describe("expandSchedule", () => {
  it("produces ordered UTC instants anchored to due date ± offsets", () => {
    const out = expandSchedule(standard, "2026-07-10", "Europe/Bucharest");
    expect(out.map((o) => o.stepIndex)).toEqual([0, 1, 2]);
    expect(new Date(out[0]!.scheduledForUtcMs).toISOString()).toBe("2026-07-07T06:00:00.000Z");
    expect(new Date(out[1]!.scheduledForUtcMs).toISOString()).toBe("2026-07-10T06:00:00.000Z");
    expect(new Date(out[2]!.scheduledForUtcMs).toISOString()).toBe("2026-07-17T06:00:00.000Z");
  });
  it("throws INVALID_SCHEDULE for invalid definitions", () => {
    expect(() => expandSchedule({ offsets: [], sendAtLocalTime: "09:00" }, "2026-07-10", "UTC"))
      .toThrow(/INVALID_SCHEDULE/);
  });
});
