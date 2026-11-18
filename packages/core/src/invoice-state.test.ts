import { describe, expect, it } from "vitest";
import {
  canTransitionLifecycle,
  deriveIsOverdue,
  derivePaymentStatus,
  shouldRemindersStop,
  transitionLifecycle,
} from "../src/invoice-state";

describe("derivePaymentStatus", () => {
  it("maps payment sums to the three payment states", () => {
    expect(derivePaymentStatus(10000n, 0n)).toBe("unpaid");
    expect(derivePaymentStatus(10000n, 1n)).toBe("partially_paid");
    expect(derivePaymentStatus(10000n, 9999n)).toBe("partially_paid");
    expect(derivePaymentStatus(10000n, 10000n)).toBe("paid");
    expect(derivePaymentStatus(10000n, 12000n)).toBe("paid"); // overpayment clamps to paid
  });
  it("rejects negative paid sums loudly", () => {
    expect(() => derivePaymentStatus(100n, -1n)).toThrow(RangeError);
  });
});

describe("deriveIsOverdue is orthogonal to payment status", () => {
  it("a partially paid invoice CAN be overdue", () => {
    expect(
      deriveIsOverdue({ lifecycle: "sent", payment: "partially_paid", dueDateBeforeToday: true }),
    ).toBe(true);
  });
  it("a paid invoice is NEVER overdue", () => {
    expect(deriveIsOverdue({ lifecycle: "sent", payment: "paid", dueDateBeforeToday: true })).toBe(
      false,
    );
  });
  it("drafts are never overdue", () => {
    expect(deriveIsOverdue({ lifecycle: "draft", payment: "unpaid", dueDateBeforeToday: true })).toBe(
      false,
    );
  });
});

describe("lifecycle transitions", () => {
  it("allows draft→sent, draft→void, sent→void only", () => {
    expect(canTransitionLifecycle("draft", "sent")).toBe(true);
    expect(canTransitionLifecycle("draft", "void")).toBe(true);
    expect(canTransitionLifecycle("sent", "void")).toBe(true);
    expect(canTransitionLifecycle("sent", "draft")).toBe(false);
    expect(canTransitionLifecycle("void", "sent")).toBe(false);
    expect(() => transitionLifecycle("void", "sent")).toThrow(/INVALID_TRANSITION/);
  });
});

describe("shouldRemindersStop", () => {
  it("stops only on full payment or void — never on partial payment", () => {
    expect(shouldRemindersStop("sent", "paid")).toBe(true);
    expect(shouldRemindersStop("void", "unpaid")).toBe(true);
    expect(shouldRemindersStop("sent", "partially_paid")).toBe(false);
    expect(shouldRemindersStop("sent", "unpaid")).toBe(false);
  });
});
