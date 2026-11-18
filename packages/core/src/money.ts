/**
 * Money arithmetic in integer minor units (DATABASE_SCHEMA conventions).
 * All invoice/payment amounts are stored as `bigint` minor units + ISO-4217 code.
 * Floating point is never used for currency math.
 */

export type CurrencyCode = string; // validated as /^[A-Z]{3}$/ by isValidCurrencyCode

export interface MinorUnitError {
  readonly ok: false;
  readonly reason: "not-finite" | "not-integer" | "out-of-safe-range";
}

const MAX_SAFE_MINOR = 9_007_199_254_740_991n; // Number.MAX_SAFE_INTEGER, storage-bound guard

/** Parse a decimal string ("1234.56", "-0.5", "1.005") into minor units with half-up rounding at the currency exponent. */
export function parseAmountToMinor(
  decimal: string,
  exponent: number,
): { ok: true; minor: bigint } | MinorUnitError {
  if (!Number.isFinite(exponent) || !Number.isInteger(exponent) || exponent < 0 || exponent > 8) {
    return { ok: false, reason: "not-integer" };
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) return { ok: false, reason: "not-finite" };
  const [, sign, intPart, fracRaw = ""] = match;
  const factor = 10n ** BigInt(exponent);
  const fracPadded = (fracRaw + "0".repeat(exponent)).slice(0, exponent);
  let minor = BigInt(intPart ?? "0") * factor + BigInt(fracPadded === "" ? "0" : fracPadded);
  // Half-up rounding on the first dropped digit.
  const dropped = fracRaw.slice(exponent);
  if (dropped.length > 0 && dropped.charCodeAt(0)! - 48 >= 5) {
    minor += 1n;
  }
  if (sign === "-") minor = -minor;
  if (minor > MAX_SAFE_MINOR || minor < -MAX_SAFE_MINOR) {
    return { ok: false, reason: "out-of-safe-range" };
  }
  return { ok: true, minor };
}

/** Format minor units back to a fixed-decimal string (no locale — display layer adds locale). */
export function formatMinor(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const factor = 10n ** BigInt(exponent);
  const whole = abs / factor;
  const frac = (abs % factor).toString().padStart(exponent, "0");
  const body = exponent > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${body}` : body;
}

export function addMinor(a: bigint, b: bigint): bigint {
  assertInRange(a);
  assertInRange(b);
  const sum = a + b;
  assertInRange(sum);
  return sum;
}

export function subtractMinor(a: bigint, b: bigint): bigint {
  return addMinor(a, -b);
}

/**
 * Compute tax minor units from a net subtotal using banker's rounding (half-to-even)
 * on the exact rational value subtotal * rate/100000 (rate in milli-percent, e.g. 19000 = 19%).
 */
export function computeTaxMinor(subtotalMinor: bigint, rateMilliPercent: bigint): bigint {
  assertInRange(subtotalMinor);
  if (rateMilliPercent < 0n) throw new RangeError("tax rate must be >= 0");
  const scaled = subtotalMinor * rateMilliPercent; // /100000
  const divisor = 100_000n;
  const quotient = scaled / divisor;
  const remainder = scaled % divisor;
  if (remainder * 2n > divisor) return quotient + 1n;
  if (remainder * 2n === divisor && quotient % 2n !== 0n) return quotient + 1n;
  return quotient;
}

function assertInRange(v: bigint): void {
  if (v > MAX_SAFE_MINOR || v < -MAX_SAFE_MINOR) {
    throw new RangeError("amount out of safe minor-unit range");
  }
}

/** ISO-4217 shape check only; full registry lives in the currency metadata module (Phase 3). */
export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}
