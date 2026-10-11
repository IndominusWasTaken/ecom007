import { DateTime } from "luxon";

/** ISO calendar date, e.g. "2026-10-11". */
export type IsoDate = string;

/** The store-local calendar date of a UTC instant. */
export function localDate(utc: string | Date, timeZone: string): IsoDate {
  const dt = typeof utc === "string" ? DateTime.fromISO(utc, { zone: "utc" }) : DateTime.fromJSDate(utc, { zone: "utc" });
  return dt.setZone(timeZone).toISODate()!;
}

export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return DateTime.fromJSDate(now).setZone(timeZone).toISODate()!;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return DateTime.fromISO(d, { zone: "utc" }).plus({ days: n }).toISODate()!;
}

export function addMonths(d: IsoDate, n: number): IsoDate {
  return DateTime.fromISO(d, { zone: "utc" }).plus({ months: n }).toISODate()!;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round(DateTime.fromISO(b, { zone: "utc" }).diff(DateTime.fromISO(a, { zone: "utc" }), "days").days);
}

/** Inclusive list of dates from..to. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type RangePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "mtd" | "custom";
export type ComparePreset = "previous" | "lastyear" | "none";

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "Month to date",
  custom: "Custom",
};

/** Resolve a preset against "today" in the given zone. "Last N days" ends yesterday, like Shopify. */
export function resolveRange(preset: RangePreset, today: IsoDate, custom?: Partial<DateRange>): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -7), to: addDays(today, -1) };
    case "30d":
      return { from: addDays(today, -30), to: addDays(today, -1) };
    case "90d":
      return { from: addDays(today, -90), to: addDays(today, -1) };
    case "mtd":
      return { from: today.slice(0, 8) + "01", to: today };
    case "custom": {
      const from = custom?.from ?? addDays(today, -30);
      const to = custom?.to ?? today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export function compareRange(r: DateRange, mode: ComparePreset): DateRange | null {
  if (mode === "none") return null;
  if (mode === "lastyear") {
    return {
      from: DateTime.fromISO(r.from).minus({ years: 1 }).toISODate()!,
      to: DateTime.fromISO(r.to).minus({ years: 1 }).toISODate()!,
    };
  }
  const len = daysBetween(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export type Granularity = "day" | "week" | "month";

/** Bucket key for a date at the chosen granularity (weeks start Monday). */
export function bucketOf(d: IsoDate, g: Granularity): IsoDate {
  if (g === "day") return d;
  if (g === "month") return d.slice(0, 8) + "01";
  return DateTime.fromISO(d, { zone: "utc" }).startOf("week").toISODate()!;
}
