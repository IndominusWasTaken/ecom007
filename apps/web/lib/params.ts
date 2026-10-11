import { compareRange, resolveRange, todayIn, type ComparePreset, type DateRange, type Granularity, type RangePreset } from "@ecom/core/dates";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface ViewParams {
  scope: string;
  currency: "USD" | "EUR";
  preset: RangePreset;
  range: DateRange;
  compareMode: ComparePreset;
  compare: DateRange | null;
  granularity: Granularity;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PRESETS: RangePreset[] = ["today", "yesterday", "7d", "30d", "90d", "mtd", "custom"];

/**
 * Every page reads scope, currency, range and comparison from the URL, so a view can be
 * bookmarked or shared between the two of you. "Today" is evaluated in Sofia time.
 */
export function parseView(sp: SearchParams, defaults: { currency?: "USD" | "EUR"; preset?: RangePreset } = {}): ViewParams {
  const preset = (PRESETS.includes(one(sp.range) as RangePreset) ? one(sp.range) : defaults.preset ?? "30d") as RangePreset;
  const today = todayIn(process.env.BUSINESS_TZ ?? "Europe/Sofia");
  const range = resolveRange(preset, today, { from: one(sp.from), to: one(sp.to) });
  const cm = one(sp.compare);
  const compareMode: ComparePreset = cm === "lastyear" || cm === "none" ? cm : "previous";
  const cur = one(sp.cur);
  const g = one(sp.g);
  return {
    scope: one(sp.scope) ?? "all",
    currency: cur === "EUR" || cur === "USD" ? cur : (defaults.currency ?? "USD"),
    preset,
    range,
    compareMode,
    compare: compareRange(range, compareMode),
    granularity: g === "week" || g === "month" ? g : range.to > range.from && daysBetween(range) > 92 ? "week" : "day",
  };
}

function daysBetween(r: DateRange) {
  return (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000;
}

/** Build a URL keeping the current view params and overriding some. */
export function withParams(path: string, sp: SearchParams, patch: Record<string, string | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = one(v);
    if (s !== undefined) u.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) u.delete(k);
    else u.set(k, v);
  }
  const q = u.toString();
  return q ? `${path}?${q}` : path;
}

export const KEEP_KEYS = ["scope", "cur", "range", "from", "to", "compare", "g"];

export function viewQuery(sp: SearchParams) {
  const u = new URLSearchParams();
  for (const k of KEEP_KEYS) {
    const v = one(sp[k]);
    if (v) u.set(k, v);
  }
  return u.toString();
}
