import { describe, expect, it } from "vitest";
import {
  addMinor,
  computeTaxMinor,
  formatMinor,
  isValidCurrencyCode,
  parseAmountToMinor,
  subtractMinor,
} from "../src/money";

describe("parseAmountToMinor", () => {
  it("parses standard two-exponent amounts", () => {
    expect(parseAmountToMinor("1234.56", 2)).toEqual({ ok: true, minor: 123456n });
    expect(parseAmountToMinor("0.5", 2)).toEqual({ ok: true, minor: 50n });
    expect(parseAmountToMinor("10", 2)).toEqual({ ok: true, minor: 1000n });
    expect(parseAmountToMinor("-7.25", 2)).toEqual({ ok: true, minor: -725n });
  });

  it("rounds half-up on dropped digits", () => {
    expect(parseAmountToMinor("1.005", 2)).toEqual({ ok: true, minor: 101n });
    expect(parseAmountToMinor("1.0049", 2)).toEqual({ ok: true, minor: 100n });
  });

  it("handles zero-exponent currencies", () => {
    expect(parseAmountToMinor("500", 0)).toEqual({ ok: true, minor: 500n });
    expect(parseAmountToMinor("500.4", 0)).toEqual({ ok: true, minor: 500n });
    expect(parseAmountToMinor("500.5", 0)).toEqual({ ok: true, minor: 501n });
  });

  it("rejects malformed input and unsafe magnitudes", () => {
    expect(parseAmountToMinor("abc", 2).ok).toBe(false);
    expect(parseAmountToMinor("1e5", 2).ok).toBe(false);
    expect(parseAmountToMinor("".repeat(0) + "9".repeat(30), 2).ok).toBe(false);
  });
});

describe("formatMinor", () => {
  it("is the inverse of parse for representable values", () => {
    expect(formatMinor(123456n, 2)).toBe("1234.56");
    expect(formatMinor(-725n, 2)).toBe("-7.25");
    expect(formatMinor(5n, 2)).toBe("0.05");
    expect(formatMinor(500n, 0)).toBe("500");
  });
});

describe("minor arithmetic guards", () => {
  it("adds and subtracts exactly", () => {
    expect(addMinor(1n, 2n)).toBe(3n);
    expect(subtractMinor(10n, 25n)).toBe(-15n);
  });
  it("throws beyond safe range", () => {
    const huge = 10n ** 30n;
    expect(() => addMinor(huge, 1n)).toThrow(RangeError);
  });
});

describe("computeTaxMinor (banker's rounding, milli-percent rates)", () => {
  it("computes 19% VAT exactly", () => {
    expect(computeTaxMinor(10000n, 19000n)).toBe(1900n);
  });
  it("half-to-even on exact halves", () => {
    // 1 * 19000 / 100000 = 0.19 -> 0 ; 3*19000/100000=0.57 -> 1
    expect(computeTaxMinor(1n, 19000n)).toBe(0n);
    expect(computeTaxMinor(3n, 19000n)).toBe(1n);
    // exact half: subtotal 50000 @ 19000 milli-% = 9500 exactly
    expect(computeTaxMinor(50000n, 19000n)).toBe(9500n);
    // half case: scaled remainder == divisor/2 → 25000*19000/100000 = 4750 exact
    // construct a real half: rate 5000 milli-% (=5%), subtotal 5 → 0.25 → rounds to 0? no: 5*5000=25000/100000=0.25
    // use subtotal 10n rate 5000n → 0.5 exactly, quotient 0 (even) → stays 0
    expect(computeTaxMinor(10n, 5000n)).toBe(0n);
    // subtotal 30n rate 5000n → 1.5 → quotient 1 (odd) → round up to 2
    expect(computeTaxMinor(30n, 5000n)).toBe(2n);
  });
  it("rejects negative rates", () => {
    expect(() => computeTaxMinor(100n, -1n)).toThrow(RangeError);
  });
});

describe("isValidCurrencyCode", () => {
  it("accepts ISO shape only", () => {
    expect(isValidCurrencyCode("EUR")).toBe(true);
    expect(isValidCurrencyCode("eur")).toBe(false);
    expect(isValidCurrencyCode("EURO")).toBe(false);
  });
});
