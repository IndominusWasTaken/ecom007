import "server-only";
import { getDb, loadMetrics, loadPerStore, loadSeries, sql, type Currency, type ResolvedScope } from "@ecom/db";
import type { DateRange, Granularity } from "@ecom/core/dates";
import type { Decimal } from "@ecom/core/money";
import { evalCtx, settings, storesAndRegions } from "./data";
import { toNum, type Num } from "./metrics";
import type { SearchParams } from "./params";

/** Shared queries for the Regions, P&L, Store analytics and Products pages and their CSV exports. */

type Bag = Record<string, Decimal | null>;
type Fmt = "money" | "number" | "percent" | "ratio";

/** URLSearchParams -> the SearchParams shape parseView expects (route handlers). */
export function spFromUrl(url: string): SearchParams {
  const out: SearchParams = {};
  for (const [k, v] of new URL(url).searchParams) out[k] = v;
  return out;
}

export function csvResponse(name: string, body: string) {
  return new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------- P&L

export interface PnlLine {
  id: string;
  label: string;
  format: Fmt;
  /** Subtotal lines are emphasised. */
  strong?: boolean;
  /** Indented detail line. */
  indent?: boolean;
  /** Only shown when the profit tax setting is on. */
  taxOnly?: boolean;
}

/** Restocked COGS returned is not a registry metric; it is COGS − adjusted COGS. */
const extra = (m: Bag, id: string): Num => {
  if (id === "restocked_cogs") {
    const c = toNum(m.cogs), a = toNum(m.adjusted_cogs);
    return c === null || a === null ? null : c - a;
  }
  return toNum(m[id]);
};

export const PNL_LINES: PnlLine[] = [
  { id: "gross_sales", label: "Gross sales", format: "money" },
  { id: "discounts", label: "Discounts", format: "money", indent: true },
  { id: "sales_reversals", label: "Sales reversals", format: "money", indent: true },
  { id: "net_sales", label: "Net sales", format: "money", strong: true },
  { id: "shipping_charges", label: "Shipping charges", format: "money", indent: true },
  { id: "return_fees", label: "Return fees", format: "money", indent: true },
  { id: "net_taxes", label: "Net taxes", format: "money", indent: true },
  { id: "total_sales", label: "Total sales", format: "money", strong: true },
  { id: "net_revenue", label: "Net revenue", format: "money", strong: true },
  { id: "cogs", label: "COGS", format: "money", indent: true },
  { id: "restocked_cogs", label: "Restocked COGS returned", format: "money", indent: true },
  { id: "adjusted_cogs", label: "Adjusted COGS", format: "money" },
  { id: "gross_profit", label: "Gross profit", format: "money", strong: true },
  { id: "shipping_cost", label: "Shipping cost", format: "money", indent: true },
  { id: "handling_fees", label: "Handling fees", format: "money", indent: true },
  { id: "payment_fees", label: "Payment fees", format: "money", indent: true },
  { id: "contribution_margin", label: "Contribution margin", format: "money", strong: true },
  { id: "ad_spend_meta", label: "Meta ad spend", format: "money", indent: true },
  { id: "ad_spend_google", label: "Google ad spend", format: "money", indent: true },
  { id: "ad_spend_tiktok", label: "TikTok ad spend", format: "money", indent: true },
  { id: "ad_spend_manual", label: "Manual ad spend", format: "money", indent: true },
  { id: "blended_ad_spend", label: "Blended ad spend", format: "money" },
  { id: "operating_expenses", label: "Operating expenses", format: "money" },
  { id: "net_profit", label: "Net profit", format: "money", strong: true },
  { id: "net_margin", label: "Net margin", format: "percent" },
  { id: "profit_tax", label: "Profit tax", format: "money", taxOnly: true },
  { id: "profit_after_tax", label: "Profit after tax", format: "money", strong: true, taxOnly: true },
];

/** The main lines used as columns of the period table. */
export const PERIOD_LINES = ["total_sales", "net_revenue", "adjusted_cogs", "gross_profit", "shipping_cost", "handling_fees", "payment_fees", "contribution_margin", "blended_ad_spend", "operating_expenses", "net_profit", "net_margin"]
  .map((id) => PNL_LINES.find((l) => l.id === id)!);

export interface PnlColumn {
  key: string;
  label: string;
  /** Native currency of the store (informational). */
  native?: string;
  total?: boolean;
  values: Record<string, Num>;
}

const valuesOf = (m: Bag): Record<string, Num> => Object.fromEntries(PNL_LINES.map((l) => [l.id, extra(m, l.id)]));

/**
 * One column per store in scope (+ Unassigned ad spend in All when non-zero) + Total.
 * Total comes from loadMetrics, the same query the Summary page uses, so they always match.
 */
export async function pnlByStore(scope: ResolvedScope, range: DateRange, currency: Currency) {
  const db = getDb();
  const ctx = evalCtx(await settings());
  const q = { scope, range, currency, ctx };
  const [per, total, stores] = await Promise.all([loadPerStore(db, q), loadMetrics(db, q), storesAndRegions()]);
  const cols: PnlColumn[] = [];
  if (scope.storeIds.length > 1 || per.has("unassigned")) {
    for (const sid of scope.storeIds) {
      const s = stores.find((r) => r.store_id === sid);
      cols.push({ key: `store:${sid}`, label: s?.store_name ?? `Store ${sid}`, native: s?.currency, values: valuesOf(per.get(sid) ?? {}) });
    }
    const u = per.get("unassigned");
    if (u) cols.push({ key: "unassigned", label: "Unassigned", values: valuesOf(u) });
  }
  cols.push({ key: "total", label: "Total", total: true, values: valuesOf(total) });
  const taxOn = total.profit_after_tax !== null;
  return { cols, lines: PNL_LINES.filter((l) => taxOn || !l.taxOnly), taxOn };
}

export async function pnlByPeriod(scope: ResolvedScope, range: DateRange, currency: Currency, granularity: Granularity) {
  const db = getDb();
  const ctx = evalCtx(await settings());
  const q = { scope, range, currency, ctx };
  const [series, total] = await Promise.all([loadSeries(db, q, granularity), loadMetrics(db, q)]);
  const taxOn = total.profit_after_tax !== null;
  const lines = [...PERIOD_LINES, ...(taxOn ? PNL_LINES.filter((l) => l.id === "profit_after_tax") : [])];
  return {
    lines,
    rows: series.map((p) => ({ period: p.date, values: valuesOf(p.metrics) })),
    total: valuesOf(total),
  };
}

// ---------------------------------------------------------------- Store analytics

const fxCol = (currency: Currency) => sql.raw(currency === "USD" ? "o.fx_to_usd" : "o.fx_to_eur");

/** Order revenue by sales channel (Online Store, Shop, POS…), test orders excluded. */
export async function salesByChannel(storeIds: number[], range: DateRange, currency: Currency) {
  const rev = sql.raw(currency === "USD" ? "order_revenue_usd" : "order_revenue_eur");
  const res = await getDb().execute<{ label: string; value: string }>(sql`
    select coalesce(nullif(channel, ''), nullif(source_name, ''), 'Unknown') as label, sum(${rev})::text as value
    from orders
    where not test and local_date between ${range.from} and ${range.to} and store_id = any(${sql.param(storeIds)}::int[])
    group by 1 order by sum(${rev}) desc`);
  return res.rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Top products by net sales ex tax (gross − discounts, converted with the order's fx). */
export async function topProducts(storeIds: number[], range: DateRange, currency: Currency, limit = 10) {
  const res = await getDb().execute<{ label: string; value: string }>(sql`
    select coalesce(max(p.title), max(ol.title)) || ${storeIds.length > 1 ? sql`' · ' || max(s.name)` : sql`''`} as label, sum((ol.gross_ex - ol.discount_ex) * ${fxCol(currency)})::text as value
    from order_lines ol
    join orders o on o.id = ol.order_id
    join stores s on s.id = o.store_id
    left join products p on p.store_id = ol.store_id and p.shopify_id = ol.product_shopify_id
    where not o.test and o.local_date between ${range.from} and ${range.to} and o.store_id = any(${sql.param(storeIds)}::int[])
    group by ol.store_id, coalesce(ol.product_shopify_id, ol.title)
    order by sum((ol.gross_ex - ol.discount_ex) * ${fxCol(currency)}) desc
    limit ${limit}`);
  return res.rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

// ---------------------------------------------------------------- Products

export interface ProductStats {
  units: number;
  netSales: number;
  cogs: number;
  grossMargin: number;
  marginPct: number | null;
  refundedUnits: number;
  refundedAmount: number;
  refundRate: number | null;
  /** Units sold on lines without a unit cost. */
  missingCostUnits: number;
}

export interface VariantRow extends ProductStats {
  key: string;
  title: string;
  sku: string | null;
}

export interface ProductRow extends ProductStats {
  key: string;
  title: string;
  store: string;
  storeCurrency: string;
  variants: VariantRow[];
}

function finish<T extends Omit<ProductStats, "grossMargin" | "marginPct" | "refundRate">>(s: T): T & ProductStats {
  const grossMargin = s.netSales - s.cogs;
  return { ...s, grossMargin, marginPct: s.netSales ? grossMargin / s.netSales : null, refundRate: s.netSales ? s.refundedAmount / s.netSales : null };
}

/**
 * Per-variant sales (order date in range) and refunds (refund date in range), in one query;
 * products are rolled up from their variants in JS so ratios are recomputed from sums.
 * Refunded amount is ex tax, like net sales. COGS = quantity × unit cost snapshot × fx.
 */
export async function productTable(storeIds: number[], range: DateRange, currency: Currency): Promise<ProductRow[]> {
  const fx = fxCol(currency);
  const res = await getDb().execute<{
    store_id: number;
    pkey: string;
    vkey: string;
    product_title: string;
    variant_title: string | null;
    sku: string | null;
    units: string;
    net_sales: string;
    cogs: string;
    missing_units: string;
    refunded_units: string;
    refunded_amount: string;
  }>(sql`
    with lines as not materialized (
      select ol.store_id, coalesce(ol.product_shopify_id, 'title:' || ol.title) pkey,
        coalesce(ol.variant_shopify_id, ol.sku, ol.title || coalesce(' / ' || ol.variant_title, '')) vkey,
        ol.title, ol.variant_title, ol.sku, ol.shopify_id, ol.quantity, ol.gross_ex, ol.discount_ex, ol.unit_cost, ol.cost_source,
        o.local_date, o.taxes_included, ${fx} fx
      from order_lines ol join orders o on o.id = ol.order_id
      where not o.test and o.store_id = any(${sql.param(storeIds)}::int[])
    ),
    sales as (
      select store_id, pkey, vkey, max(title) title, max(variant_title) variant_title, max(sku) sku,
        sum(quantity) units, sum((gross_ex - discount_ex) * fx) net_sales,
        sum(coalesce(quantity * unit_cost * fx, 0)) cogs,
        sum(quantity) filter (where cost_source = 'missing' or unit_cost is null) missing_units
      from lines where local_date between ${range.from} and ${range.to}
      group by 1, 2, 3
    ),
    refunded as (
      select l.store_id, l.pkey, l.vkey, max(l.title) title, max(l.variant_title) variant_title, max(l.sku) sku,
        sum(rl.quantity) refunded_units,
        sum((rl.subtotal - case when l.taxes_included then rl.tax else 0 end) * l.fx) refunded_amount
      from refund_lines rl
      join refunds r on r.id = rl.refund_id
      join lines l on l.store_id = rl.store_id and l.shopify_id = rl.order_line_shopify_id
      where r.local_date between ${range.from} and ${range.to}
      group by 1, 2, 3
    )
    select coalesce(s.store_id, f.store_id) store_id, coalesce(s.pkey, f.pkey) pkey, coalesce(s.vkey, f.vkey) vkey,
      coalesce(p.title, s.title, f.title) product_title, coalesce(s.variant_title, f.variant_title) variant_title, coalesce(s.sku, f.sku) sku,
      coalesce(s.units, 0)::text units, coalesce(s.net_sales, 0)::text net_sales, coalesce(s.cogs, 0)::text cogs,
      coalesce(s.missing_units, 0)::text missing_units,
      coalesce(f.refunded_units, 0)::text refunded_units, coalesce(f.refunded_amount, 0)::text refunded_amount
    from sales s
    full join refunded f on f.store_id = s.store_id and f.pkey = s.pkey and f.vkey = s.vkey
    left join products p on p.store_id = coalesce(s.store_id, f.store_id) and p.shopify_id = coalesce(s.pkey, f.pkey)`);

  const stores = await storesAndRegions();
  const products = new Map<string, ProductRow>();
  for (const r of res.rows) {
    const key = `${r.store_id}|${r.pkey}`;
    let p = products.get(key);
    if (!p) {
      const s = stores.find((x) => x.store_id === Number(r.store_id));
      p = { key, title: r.product_title, store: s?.store_name ?? "", storeCurrency: s?.currency ?? "", variants: [], units: 0, netSales: 0, cogs: 0, grossMargin: 0, marginPct: null, refundedUnits: 0, refundedAmount: 0, refundRate: null, missingCostUnits: 0 };
      products.set(key, p);
    }
    const v = finish({
      key: `${key}|${r.vkey}`,
      title: r.variant_title || "Default",
      sku: r.sku,
      units: Number(r.units),
      netSales: Number(r.net_sales),
      cogs: Number(r.cogs),
      missingCostUnits: Number(r.missing_units),
      refundedUnits: Number(r.refunded_units),
      refundedAmount: Number(r.refunded_amount),
    });
    p.variants.push(v);
    p.units += v.units;
    p.netSales += v.netSales;
    p.cogs += v.cogs;
    p.missingCostUnits += v.missingCostUnits;
    p.refundedUnits += v.refundedUnits;
    p.refundedAmount += v.refundedAmount;
  }
  return [...products.values()].map((p) => finish(p));
}

export const PRODUCT_COLUMNS = [
  { id: "title", label: "Product", format: null },
  { id: "units", label: "Units sold", format: "number" },
  { id: "netSales", label: "Net sales", format: "money" },
  { id: "cogs", label: "COGS", format: "money" },
  { id: "grossMargin", label: "Gross margin", format: "money" },
  { id: "marginPct", label: "Margin %", format: "percent" },
  { id: "refundedUnits", label: "Refunded units", format: "number" },
  { id: "refundedAmount", label: "Refunded", format: "money" },
  { id: "refundRate", label: "Refund rate", format: "percent" },
] as const;

export type ProductSort = (typeof PRODUCT_COLUMNS)[number]["id"];

/** Search (q matches product, variant or SKU), sort (sort=<column>, dir=asc|desc). */
export function filterAndSort(rows: ProductRow[], q: string, sort: string, dir: "asc" | "desc", byVariant: boolean) {
  const needle = q.trim().toLowerCase();
  const match = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle);
  let out = needle
    ? rows
        .map((p) => (match(p.title) ? p : { ...p, variants: p.variants.filter((v) => match(v.title) || match(v.sku)) }))
        .filter((p) => match(p.title) || p.variants.length > 0)
    : rows;
  const col = (PRODUCT_COLUMNS.find((c) => c.id === sort)?.id ?? "netSales") as ProductSort;
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: ProductStats & { title: string }, b: ProductStats & { title: string }) => {
    if (col === "title") return sign * a.title.localeCompare(b.title);
    const x = a[col] ?? -Infinity, y = b[col] ?? -Infinity;
    return sign * (x - y) || a.title.localeCompare(b.title);
  };
  out = out.map((p) => ({ ...p, variants: [...p.variants].sort(cmp) })).sort(cmp);
  if (!byVariant) return out;
  // flat list: each variant becomes its own row, sorted together
  return out
    .flatMap((p) => p.variants.map((v) => ({ ...v, title: `${p.title} — ${v.title}`, productTitle: p.title, variantTitle: v.title, store: p.store, storeCurrency: p.storeCurrency, variants: [] as VariantRow[] })))
    .sort(cmp);
}
