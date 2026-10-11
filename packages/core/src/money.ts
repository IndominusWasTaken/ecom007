import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
export type DecimalLike = Decimal | string | number | null | undefined;

/** Parse anything money-ish into a Decimal; null/undefined/"" become 0. */
export function D(v: DecimalLike): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return v instanceof Decimal ? v : new Decimal(v);
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** Money is persisted as numeric(20,6) strings. */
export function toDb(v: DecimalLike): string {
  return D(v).toDecimalPlaces(6).toFixed(6);
}

/** Safe division: returns null when the denominator is zero. */
export function div(a: DecimalLike, b: DecimalLike): Decimal | null {
  const den = D(b);
  if (den.isZero()) return null;
  return D(a).div(den);
}

const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", BGN: "лв " };

export function formatMoney(v: DecimalLike, currency: string, opts: { compact?: boolean } = {}): string {
  const n = D(v).toNumber();
  const sym = symbols[currency] ?? `${currency} `;
  const abs = Math.abs(n);
  let body: string;
  if (opts.compact && abs >= 10_000) {
    body = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(abs);
  } else {
    body = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  }
  return `${n < 0 ? "−" : ""}${sym}${body}`;
}
