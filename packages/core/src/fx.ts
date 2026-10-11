import { D, Decimal, type DecimalLike } from "./money";

/**
 * ECB publishes "1 EUR = x CCY". A rate table maps ISO date -> currency -> units per EUR.
 * Conversions go through EUR, so USD↔EUR and any third currency stay consistent.
 * Weekends and holidays use the most recent earlier rate.
 */
export type EurRates = Map<string, Record<string, string>>; // date -> { USD: "1.0812", ... }

export class FxTable {
  private dates: string[];
  constructor(private rates: EurRates) {
    this.dates = [...rates.keys()].sort();
  }

  get size() {
    return this.dates.length;
  }

  /** Units of `ccy` per 1 EUR on or before `date`. */
  perEur(ccy: string, date: string): Decimal {
    if (ccy === "EUR") return new Decimal(1);
    // binary search for the last date <= target
    let lo = 0;
    let hi = this.dates.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // walk back in case a given day lacks this currency
    for (let i = found; i >= 0; i--) {
      const r = this.rates.get(this.dates[i])?.[ccy];
      if (r) return new Decimal(r);
    }
    // before the first known date: use the earliest rate we have
    for (let i = 0; i < this.dates.length; i++) {
      const r = this.rates.get(this.dates[i])?.[ccy];
      if (r) return new Decimal(r);
    }
    throw new Error(`No FX rate for ${ccy} on or before ${date}`);
  }

  convert(amount: DecimalLike, from: string, to: string, date: string): Decimal {
    if (from === to) return D(amount);
    const eur = D(amount).div(this.perEur(from, date));
    return eur.mul(this.perEur(to, date));
  }
}
