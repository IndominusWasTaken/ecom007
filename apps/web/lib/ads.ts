import "server-only";
import { getDb, sql, type Currency, type ResolvedScope } from "@ecom/db";
import { AD_COUNT_FIELDS, AD_METRICS, addAdTotals, deriveAd, emptyAdTotals, type AdTotals } from "@ecom/metrics";
import type { AdStatus } from "@/components/ads/StatusPill";
import type { Num } from "./metrics";

type SQL = ReturnType<typeof sql>;

/** Plain-number metric bag for client components: summed parts plus derived ratios. */
export type AdValues = Record<string, Num>;

/** Column metadata for the client (AD_METRICS without anything non-serialisable). */
export const adMetricMeta = () => AD_METRICS.map((m) => ({ id: m.id as string, label: m.label, format: m.format, formula: m.formula, higherIsBetter: m.higherIsBetter }));
export type AdMetricMeta = ReturnType<typeof adMetricMeta>[number];

/**
 * Which daily_ad_metrics rows a scope covers (alias `m`). Store and region scopes take the
 * mapped rows only; All also takes Unassigned spend (store_id null). `unassignedOnly` shows
 * only the spend no store is mapped to.
 */
export function adScopeWhere(scope: ResolvedScope, unassignedOnly = false): SQL {
  if (unassignedOnly) return sql`m.store_id is null`;
  const ids = sql`${sql.param(scope.storeIds)}::int[]`;
  return scope.includeUnassigned ? sql`(m.store_id = any(${ids}) or m.store_id is null)` : sql`m.store_id = any(${ids})`;
}

/** SELECT list summing every raw ad field, picking the money columns for the display currency. */
export function adSumSelect(currency: Currency, filter?: SQL): SQL {
  const f = filter ? sql` filter (where ${filter})` : sql``;
  const cur = currency === "EUR" ? "eur" : "usd";
  const parts = [
    sql`coalesce(sum(${sql.raw(`m.spend_${cur}`)})${f}, 0)::text as spend`,
    sql`coalesce(sum(${sql.raw(`m.purchase_value_${cur}`)})${f}, 0)::text as purchase_value`,
    ...AD_COUNT_FIELDS.map((c) => sql`coalesce(sum(${sql.raw(`m.${c}`)})${f}, 0)::text as ${sql.raw(c)}`),
  ];
  return sql.join(parts, sql`, `);
}

export function totalsOf(row: Record<string, unknown>): AdTotals {
  return addAdTotals(emptyAdTotals(), row as Partial<Record<keyof AdTotals, string>>);
}

/** Summed parts and ratios (via deriveAd) as plain numbers. */
export function adValues(t: AdTotals): AdValues {
  const out: AdValues = {};
  for (const [k, v] of Object.entries(t)) out[k] = v.toNumber();
  for (const [k, v] of Object.entries(deriveAd(t))) out[k] = v === null ? null : v.toNumber();
  return out;
}

/** Normalise Meta effective_status into the three states we show. */
export function statusOf(effective: string | null | undefined): AdStatus {
  const s = (effective ?? "").toUpperCase();
  if (s === "ACTIVE" || s === "IN_PROCESS" || s === "WITH_ISSUES" || s === "PENDING_REVIEW" || s === "PREAPPROVED") return "active";
  if (s === "ARCHIVED" || s === "DELETED" || s === "DISAPPROVED") return "archived";
  return "paused";
}

/** Daily spend series (Meta-reported) for a scope, one point per day in the range. */
export async function spendSeries(
  where: SQL,
  range: { from: string; to: string },
  currency: Currency,
): Promise<[string, number][]> {
  const col = sql.raw(currency === "EUR" ? "m.spend_eur" : "m.spend_usd");
  const res = await getDb().execute<{ date: string; v: string }>(
    sql`select d::date::text as date, coalesce(sum(${col}), 0)::text as v
        from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
        left join daily_ad_metrics m on m.date = d::date and ${where}
        group by d order by d`,
  );
  return res.rows.map((r) => [r.date, Number(r.v)]);
}
