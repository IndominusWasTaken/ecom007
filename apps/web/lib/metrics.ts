import "server-only";
import { getDb, loadMetrics, loadSeries, sql, type Currency, type ResolvedScope } from "@ecom/db";
import { METRICS, change } from "@ecom/metrics";
import type { DateRange, Granularity } from "@ecom/core/dates";
import type { Decimal } from "@ecom/core/money";
import { evalCtx, settings } from "./data";

export type Num = number | null;
export const toNum = (d: Decimal | null | undefined): Num => (d === null || d === undefined ? null : d.toNumber());

export interface MetricMeta {
  id: string;
  label: string;
  format: "money" | "number" | "percent" | "ratio";
  formula: string;
  higherIsBetter: boolean;
  section: string;
  source: string;
  platformReported?: boolean;
}

export const metricMeta = (): MetricMeta[] =>
  METRICS.map((m) => ({ id: m.id, label: m.label, format: m.format, formula: m.formula, higherIsBetter: m.higherIsBetter, section: m.section, source: m.source, platformReported: m.platformReported }));

/** Sessions are "not connected" when any store in scope lacks ShopifyQL access. */
export async function sessionsConnected(scope: ResolvedScope) {
  const res = await getDb().execute<{ id: number; sessions_status: string }>(sql`select id, sessions_status from stores where id = any(${sql.param(scope.storeIds)}::int[])`);
  return res.rows.every((r) => r.sessions_status !== "not_connected");
}

export interface MetricBundle {
  current: Record<string, Num>;
  previous: Record<string, Num> | null;
  changes: Record<string, number | null>;
  series: Record<string, [string, Num][]>;
  compareSeries: Record<string, [string, Num][]> | null;
  sessionsOk: boolean;
}

export async function metricBundle(scope: ResolvedScope, range: DateRange, compare: DateRange | null, currency: Currency, granularity: Granularity = "day"): Promise<MetricBundle> {
  const db = getDb();
  const ctx = evalCtx(await settings());
  const sessionsOk = await sessionsConnected(scope);
  const q = { scope, range, currency, ctx };
  const [cur, prev, ser, cser] = await Promise.all([
    loadMetrics(db, q, sessionsOk),
    compare ? loadMetrics(db, { ...q, range: compare }, sessionsOk) : Promise.resolve(null),
    loadSeries(db, q, granularity),
    compare ? loadSeries(db, { ...q, range: compare }, granularity) : Promise.resolve(null),
  ]);
  const current: Record<string, Num> = {};
  const previous: Record<string, Num> | null = prev ? {} : null;
  const changes: Record<string, number | null> = {};
  for (const m of METRICS) {
    current[m.id] = toNum(cur[m.id]);
    if (prev && previous) {
      previous[m.id] = toNum(prev[m.id]);
      changes[m.id] = change(cur[m.id], prev[m.id]);
    }
  }
  const series: Record<string, [string, Num][]> = {};
  const compareSeries: Record<string, [string, Num][]> | null = cser ? {} : null;
  for (const m of METRICS) {
    series[m.id] = ser.map((p) => [p.date, toNum(p.metrics[m.id])]);
    if (cser && compareSeries) compareSeries[m.id] = cser.map((p) => [p.date, toNum(p.metrics[m.id])]);
  }
  return { current, previous, changes, series, compareSeries, sessionsOk };
}
