import { sql, type SQL } from "drizzle-orm";
import { Decimal } from "@ecom/core/money";
import { bucketOf, eachDay, type Granularity, type DateRange } from "@ecom/core/dates";
import { ALL_ADDITIVE, COUNT_COMPONENTS, MONEY_COMPONENTS, evaluate, type EvalContext } from "@ecom/metrics";
import type { Db } from "./client";

export type ScopeKey = string; // "all" | "region:us" | "store:3"
export type Currency = "USD" | "EUR";

export interface ResolvedScope {
  key: ScopeKey;
  label: string;
  storeIds: number[];
  /** Unassigned ad spend belongs to no store; it is counted only in the All scope. */
  includeUnassigned: boolean;
}

export async function listStoresAndRegions(db: Db) {
  const res = await db.execute<{
    store_id: number;
    store_name: string;
    currency: string;
    time_zone: string;
    region_id: number;
    region_name: string;
    region_code: string;
    color: string | null;
    active: boolean;
  }>(sql`select s.id store_id, s.name store_name, s.currency, s.time_zone, s.color, s.active, r.id region_id, r.name region_name, r.code region_code
         from stores s join regions r on r.id = s.region_id order by r.sort_order, r.name, s.name`);
  return res.rows;
}

export async function resolveScope(db: Db, key: ScopeKey | undefined | null): Promise<ResolvedScope> {
  const rows = (await listStoresAndRegions(db)).filter((r) => r.active);
  const k = key || "all";
  if (k.startsWith("region:")) {
    const code = k.slice(7);
    const ids = rows.filter((r) => r.region_code === code).map((r) => r.store_id);
    const name = rows.find((r) => r.region_code === code)?.region_name ?? code.toUpperCase();
    return { key: k, label: name, storeIds: ids, includeUnassigned: false };
  }
  if (k.startsWith("store:")) {
    const id = Number(k.slice(6));
    const row = rows.find((r) => r.store_id === id);
    return { key: k, label: row?.store_name ?? `Store ${id}`, storeIds: row ? [id] : [], includeUnassigned: false };
  }
  return { key: "all", label: "All stores", storeIds: rows.map((r) => r.store_id), includeUnassigned: true };
}

const idList = (ids: number[]): SQL => (ids.length ? sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`(NULL)`);

/** SELECT list summing every additive component. */
function sumColumns(): SQL {
  return sql.raw(ALL_ADDITIVE.map((c) => `coalesce(sum(${c}),0)::text as ${c}`).join(", "));
}

type Bag = Record<string, Decimal>;

function toBag(row: Record<string, unknown> | undefined): Bag {
  const out: Bag = {};
  for (const c of ALL_ADDITIVE) out[c] = new Decimal((row?.[c] as string) ?? 0);
  return out;
}

async function unassignedSpend(db: Db, range: DateRange, currency: Currency, byDay: boolean) {
  const col = sql.raw(currency === "USD" ? "spend_usd" : "spend_eur");
  const pv = sql.raw(currency === "USD" ? "purchase_value_usd" : "purchase_value_eur");
  const res = await db.execute<{ date: string; spend: string; pv: string; purchases: string; impressions: string; link_clicks: string; clicks: string }>(sql`
    select ${byDay ? sql`date` : sql`null`} as date, coalesce(sum(${col}),0)::text spend, coalesce(sum(${pv}),0)::text pv,
      coalesce(sum(purchases),0)::text purchases, coalesce(sum(impressions),0)::text impressions,
      coalesce(sum(link_clicks),0)::text link_clicks, coalesce(sum(clicks),0)::text clicks
    from daily_ad_metrics where store_id is null and date between ${range.from} and ${range.to}
    ${byDay ? sql`group by date` : sql``}`);
  return res.rows;
}

function addUnassigned(bag: Bag, u: { spend: string; pv: string; purchases: string; impressions: string; link_clicks: string; clicks: string }) {
  bag.ad_spend_meta = bag.ad_spend_meta.plus(u.spend);
  bag.meta_purchase_value = bag.meta_purchase_value.plus(u.pv);
  bag.meta_purchases = bag.meta_purchases.plus(u.purchases);
  bag.impressions = bag.impressions.plus(u.impressions);
  bag.link_clicks = bag.link_clicks.plus(u.link_clicks);
  bag.clicks = bag.clicks.plus(u.clicks);
}

/** Distinct new / returning customers for a range (not additive across days). */
async function distinctCustomers(db: Db, storeIds: number[], range: DateRange) {
  if (!storeIds.length) return { new_customers: new Decimal(0), returning_customers: new Decimal(0) };
  const res = await db.execute<{ new_customers: string; returning_customers: string }>(sql`
    with firsts as (
      select store_id, customer_id, min(local_date) first_date from orders
      where not test and customer_id is not null and store_id in ${idList(storeIds)}
      group by store_id, customer_id
    )
    select
      count(distinct (o.store_id, o.customer_id)) filter (where f.first_date >= ${range.from})::text as new_customers,
      count(distinct (o.store_id, o.customer_id)) filter (where f.first_date < ${range.from})::text as returning_customers
    from orders o join firsts f on f.store_id = o.store_id and f.customer_id = o.customer_id
    where not o.test and o.local_date between ${range.from} and ${range.to} and o.store_id in ${idList(storeIds)}`);
  const r = res.rows[0];
  return { new_customers: new Decimal(r?.new_customers ?? 0), returning_customers: new Decimal(r?.returning_customers ?? 0) };
}

export interface MetricQuery {
  scope: ResolvedScope;
  range: DateRange;
  currency: Currency;
  ctx?: EvalContext;
}

/** Summed components for a scope and range, plus the distinct-customer counts. */
export async function loadTotals(db: Db, q: MetricQuery): Promise<Bag> {
  const res = await db.execute(sql`select ${sumColumns()} from daily_store_metrics
    where currency = ${q.currency} and date between ${q.range.from} and ${q.range.to} and store_id in ${idList(q.scope.storeIds)}`);
  const bag = toBag(res.rows[0] as Record<string, unknown>);
  if (q.scope.includeUnassigned) for (const u of await unassignedSpend(db, q.range, q.currency, false)) addUnassigned(bag, u);
  Object.assign(bag, await distinctCustomers(db, q.scope.storeIds, q.range));
  return bag;
}

export async function loadMetrics(db: Db, q: MetricQuery, sessionsAvailable = true) {
  const bag: Record<string, Decimal | null> = await loadTotals(db, q);
  if (!sessionsAvailable) for (const k of ["sessions", "added_to_cart", "reached_checkout", "completed_checkout"]) bag[k] = null;
  return evaluate(bag, q.ctx);
}

/** Per-bucket component bags for charts and sparklines. Distinct customers are computed per bucket on demand only. */
export async function loadSeries(db: Db, q: MetricQuery, granularity: Granularity = "day") {
  const res = await db.execute(sql`select date::text as date, ${sumColumns()} from daily_store_metrics
    where currency = ${q.currency} and date between ${q.range.from} and ${q.range.to} and store_id in ${idList(q.scope.storeIds)}
    group by date order by date`);
  const byDay = new Map<string, Bag>();
  for (const row of res.rows as Record<string, unknown>[]) byDay.set(row.date as string, toBag(row));
  if (q.scope.includeUnassigned) {
    for (const u of await unassignedSpend(db, q.range, q.currency, true)) {
      const b = byDay.get(u.date) ?? toBag(undefined);
      addUnassigned(b, u);
      byDay.set(u.date, b);
    }
  }
  const buckets = new Map<string, Bag>();
  for (const d of eachDay(q.range.from, q.range.to)) {
    const key = bucketOf(d, granularity);
    const b = buckets.get(key) ?? toBag(undefined);
    const day = byDay.get(d);
    if (day) for (const c of ALL_ADDITIVE) b[c] = b[c].plus(day[c]);
    buckets.set(key, b);
  }
  return [...buckets.entries()].map(([date, bag]) => ({ date, metrics: evaluate(bag, q.ctx) }));
}

/** One column per store (plus Unassigned in All) for the P&L. */
export async function loadPerStore(db: Db, q: MetricQuery) {
  const res = await db.execute(sql`select store_id, ${sumColumns()} from daily_store_metrics
    where currency = ${q.currency} and date between ${q.range.from} and ${q.range.to} and store_id in ${idList(q.scope.storeIds)}
    group by store_id`);
  const out = new Map<number | "unassigned", Record<string, Decimal | null>>();
  for (const sid of q.scope.storeIds) {
    const row = (res.rows as Record<string, unknown>[]).find((r) => Number(r.store_id) === sid);
    const bag: Record<string, Decimal | null> = toBag(row);
    Object.assign(bag, await distinctCustomers(db, [sid], q.range));
    out.set(sid, evaluate(bag, q.ctx));
  }
  if (q.scope.includeUnassigned) {
    const bag = toBag(undefined);
    for (const u of await unassignedSpend(db, q.range, q.currency, false)) addUnassigned(bag, u);
    if (!bag.ad_spend_meta.isZero()) out.set("unassigned", evaluate(bag, q.ctx));
  }
  return out;
}

export { MONEY_COMPONENTS, COUNT_COMPONENTS };
