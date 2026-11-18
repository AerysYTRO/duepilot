/**
 * Invoice state model — three orthogonal dimensions (DATABASE_SCHEMA §3).
 * Never conflate them: overdue is a derived flag, not a payment state.
 */

export type LifecycleStatus = "draft" | "sent" | "void";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid";

export interface InvoiceStateInput {
  readonly lifecycle: LifecycleStatus;
  readonly totalMinor: bigint;
  readonly paidMinor: bigint;
}

/** Derive payment status from the payment sum. Pure; mirrors the DB trigger exactly. */
export function derivePaymentStatus(totalMinor: bigint, paidMinor: bigint): PaymentStatus {
  if (paidMinor < 0n) throw new RangeError("paidMinor cannot be negative");
  if (totalMinor <= 0n) return paidMinor >= totalMinor ? "paid" : "unpaid";
  if (paidMinor === 0n) return "unpaid";
  if (paidMinor >= totalMinor) return "paid";
  return "partially_paid";
}

/** Derived overdue flag: sent, not fully paid, and past due date (org-timezone today supplied by caller). */
export function deriveIsOverdue(args: {
  lifecycle: LifecycleStatus;
  payment: PaymentStatus;
  dueDateBeforeToday: boolean;
}): boolean {
  return args.lifecycle === "sent" && args.payment !== "paid" && args.dueDateBeforeToday;
}

const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleStatus, readonly LifecycleStatus[]>> = {
  draft: ["sent", "void"],
  sent: ["void"],
  void: [],
};

export function canTransitionLifecycle(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Guarded transition; throws on illegal moves (DB trigger mirrors this). */
export function transitionLifecycle(from: LifecycleStatus, to: LifecycleStatus): LifecycleStatus {
  if (!canTransitionLifecycle(from, to)) {
    throw new Error(`INVALID_TRANSITION: ${from} -> ${to}`);
  }
  return to;
}

/** Reminders stop only on full payment or void — partial payments keep the cadence alive. */
export function shouldRemindersStop(lifecycle: LifecycleStatus, payment: PaymentStatus): boolean {
  return lifecycle === "void" || payment === "paid";
}
