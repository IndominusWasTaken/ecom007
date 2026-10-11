import { DateTime } from "luxon";
import type { IsoDate } from "./dates";

export type BillingCycle = "monthly" | "yearly" | "every_n_months" | "one_off";

export interface RecurringSpec {
  cycle: BillingCycle;
  everyNMonths?: number | null;
  /** The anchor charge date: the first (or any known) renewal. */
  anchorDate: IsoDate;
  startDate?: IsoDate | null;
  endDate?: IsoDate | null;
}

export function cycleMonths(spec: Pick<RecurringSpec, "cycle" | "everyNMonths">): number | null {
  switch (spec.cycle) {
    case "monthly":
      return 1;
    case "yearly":
      return 12;
    case "every_n_months":
      return Math.max(1, spec.everyNMonths ?? 1);
    case "one_off":
      return null;
  }
}

/**
 * Charge dates within [from, to], cash basis: the full amount lands on each date.
 * Month arithmetic is anchored on the original day (Jan 31 -> Feb 28 -> Mar 31).
 */
export function chargeDates(spec: RecurringSpec, from: IsoDate, to: IsoDate): IsoDate[] {
  const months = cycleMonths(spec);
  const start = spec.startDate && spec.startDate > from ? spec.startDate : from;
  const end = spec.endDate && spec.endDate < to ? spec.endDate : to;
  if (start > end) return [];
  if (months === null) {
    return spec.anchorDate >= start && spec.anchorDate <= end ? [spec.anchorDate] : [];
  }
  const anchor = DateTime.fromISO(spec.anchorDate, { zone: "utc" });
  const out: IsoDate[] = [];
  // find first k such that anchor + k*months >= start (k may be negative)
  const startDt = DateTime.fromISO(start, { zone: "utc" });
  let k = Math.floor(startDt.diff(anchor, "months").months / months) - 1;
  for (let guard = 0; guard < 10_000; guard++, k++) {
    const d = anchor.plus({ months: k * months }).toISODate()!;
    if (d < start) continue;
    if (d > end) break;
    if (spec.startDate && d < spec.startDate) continue;
    out.push(d);
  }
  return out;
}

export function nextChargeDate(spec: RecurringSpec, onOrAfter: IsoDate): IsoDate | null {
  const horizon = DateTime.fromISO(onOrAfter).plus({ years: 5 }).toISODate()!;
  return chargeDates(spec, onOrAfter, horizon)[0] ?? null;
}

/** Monthly-equivalent cost of a recurring amount. */
export function monthlyEquivalent(amount: number, spec: Pick<RecurringSpec, "cycle" | "everyNMonths">): number {
  const m = cycleMonths(spec);
  return m === null ? 0 : amount / m;
}

/** Default reminder lead time: 7 days for yearly-ish, 2 days for monthly. */
export function defaultReminderDays(spec: Pick<RecurringSpec, "cycle" | "everyNMonths">): number {
  const m = cycleMonths(spec);
  if (m === null) return 2;
  return m >= 12 ? 7 : m >= 3 ? 5 : 2;
}
