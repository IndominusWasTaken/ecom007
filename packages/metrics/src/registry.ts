import { D, Decimal } from "@ecom/core/money";
import type { ComponentId } from "./components";

export type MetricFormat = "money" | "number" | "percent" | "ratio";
export type MetricSection = "store" | "ads" | "costs" | "expenses" | "web" | "profit";
export type MetricSource = "shopify" | "shopify-sessions" | "meta" | "costs" | "expenses" | "blended";

export interface EvalContext {
  /** Profit tax rate as a fraction (0.10 = 10%). 0 disables "profit after tax". */
  profitTaxRate: number;
}

export type Getter = (id: string) => Decimal | null;

export interface MetricDef {
  id: string;
  label: string;
  section: MetricSection;
  format: MetricFormat;
  source: MetricSource;
  /** Human formula, rendered in METRICS.md and tile tooltips. */
  formula: string;
  /** Does a rising value mean good news? Drives the green/red change arrow. */
  higherIsBetter: boolean;
  /** "sum": additive over stores and days. Ratios are "derived" and recomputed from parts. */
  kind: "sum" | "derived";
  /** Component id for kind "sum". */
  component?: ComponentId;
  compute?: (get: Getter, ctx: EvalContext) => Decimal | null;
  /** Label numbers attributed by the ad platform. */
  platformReported?: boolean;
}

const nz = (v: Decimal | null) => v ?? new Decimal(0);
const ratio = (a: Decimal | null, b: Decimal | null): Decimal | null => {
  if (a === null || b === null || b.isZero()) return null;
  return a.div(b);
};

function sumMetric(
  id: string,
  label: string,
  section: MetricSection,
  format: MetricFormat,
  source: MetricSource,
  formula: string,
  higherIsBetter = true,
  component: ComponentId = id as ComponentId,
): MetricDef {
  return { id, label, section, format, source, formula, higherIsBetter, kind: "sum", component };
}

function derived(
  id: string,
  label: string,
  section: MetricSection,
  format: MetricFormat,
  source: MetricSource,
  formula: string,
  compute: MetricDef["compute"],
  higherIsBetter = true,
  extra: Partial<MetricDef> = {},
): MetricDef {
  return { id, label, section, format, source, formula, higherIsBetter, kind: "derived", compute, ...extra };
}

export const METRICS: MetricDef[] = [
  // ---------------- Sales ----------------
  sumMetric("gross_sales", "Gross sales", "store", "money", "shopify", "Unit price × quantity, before discounts, returns, shipping and tax"),
  sumMetric("discounts", "Discounts", "store", "money", "shopify", "Line and order discounts", false),
  sumMetric("sales_reversals", "Sales reversals", "store", "money", "shopify", "Value of refunded items, counted on the refund date", false),
  derived("net_sales", "Net sales", "store", "money", "shopify", "Gross sales − discounts − sales reversals", (g) =>
    nz(g("gross_sales")).minus(nz(g("discounts"))).minus(nz(g("sales_reversals"))),
  ),
  derived("shipping_charges", "Shipping charges", "store", "money", "shopify", "Shipping paid by customers, less shipping refunded", (g) =>
    nz(g("shipping_gross")).minus(nz(g("shipping_refunded"))),
  ),
  sumMetric("return_fees", "Return fees", "store", "money", "shopify", "Fees charged to customers on returns"),
  sumMetric("sale_taxes", "Sale taxes", "store", "money", "shopify", "Tax collected on orders", true, "order_taxes"),
  derived("net_taxes", "Net taxes", "store", "money", "shopify", "Sale taxes − tax refunded", (g) => nz(g("sale_taxes")).minus(nz(g("tax_refunded")))),
  derived(
    "total_sales",
    "Total sales",
    "store",
    "money",
    "shopify",
    "Net sales + shipping charges + return fees + net taxes",
    (g) => nz(g("net_sales")).plus(nz(g("shipping_charges"))).plus(nz(g("return_fees"))).plus(nz(g("net_taxes"))),
  ),
  sumMetric("order_revenue", "Order revenue", "store", "money", "shopify", "Gross sales − discounts + shipping + taxes for orders placed in the period, before refunds"),

  // ---------------- Orders & customers ----------------
  sumMetric("orders", "Orders", "store", "number", "shopify", "Orders placed in the period, test orders excluded"),
  sumMetric("non_zero_orders", "Non-zero orders", "store", "number", "shopify", "Orders with order revenue above zero"),
  sumMetric("units_sold", "Units sold", "store", "number", "shopify", "Sum of line item quantities"),
  derived("aov", "AOV", "store", "money", "shopify", "(Order revenue − shipping − taxes) ÷ orders", (g) =>
    ratio(nz(g("order_revenue")).minus(nz(g("shipping_gross"))).minus(nz(g("sale_taxes"))), g("orders")),
  ),
  derived("true_aov", "True AOV", "store", "money", "shopify", "(Order revenue − shipping − taxes) ÷ non-zero orders", (g) =>
    ratio(nz(g("order_revenue")).minus(nz(g("shipping_gross"))).minus(nz(g("sale_taxes"))), g("non_zero_orders")),
  ),
  sumMetric("new_customer_orders", "New customer orders", "store", "number", "shopify", "Orders that are the customer's first in that store"),
  sumMetric("returning_customer_orders", "Returning customer orders", "store", "number", "shopify", "Orders from customers who ordered before in that store"),
  sumMetric("new_customers", "New customers", "store", "number", "shopify", "Distinct customers whose first order in the store falls in the period"),
  sumMetric("returning_customers", "Returning customers", "store", "number", "shopify", "Distinct customers who ordered in the period and had ordered before"),
  derived("new_customers_pct", "New customers %", "store", "percent", "shopify", "New customers ÷ all customers who ordered in the period", (g) =>
    ratio(g("new_customers"), nz(g("new_customers")).plus(nz(g("returning_customers")))),
  ),
  derived(
    "returning_customers_pct",
    "Returning customers %",
    "store",
    "percent",
    "shopify",
    "Returning customers ÷ all customers who ordered in the period (Shopify: returning customer rate)",
    (g) => ratio(g("returning_customers"), nz(g("new_customers")).plus(nz(g("returning_customers")))),
  ),
  sumMetric("new_customer_revenue", "New customer revenue", "store", "money", "shopify", "Order revenue from new customers"),
  sumMetric("returning_customer_revenue", "Returning customer revenue", "store", "money", "shopify", "Order revenue from returning customers"),
  sumMetric("orders_fulfilled", "Orders fulfilled", "store", "number", "shopify", "Orders fulfilled in the period"),

  // ---------------- Web analytics ----------------
  sumMetric("sessions", "Sessions", "web", "number", "shopify-sessions", "Read from Shopify (ShopifyQL sessions)"),
  sumMetric("added_to_cart", "Added to cart", "web", "number", "shopify-sessions", "Sessions with an add to cart, read from Shopify"),
  sumMetric("reached_checkout", "Reached checkout", "web", "number", "shopify-sessions", "Sessions that reached checkout, read from Shopify"),
  sumMetric("completed_checkout", "Completed checkout", "web", "number", "shopify-sessions", "Sessions that completed checkout, read from Shopify"),
  derived("conversion_rate", "Conversion rate", "web", "percent", "shopify-sessions", "Sessions that completed checkout ÷ sessions", (g) =>
    ratio(g("completed_checkout"), g("sessions")),
  ),
  derived("revenue_per_session", "Revenue per session", "web", "money", "blended", "Total sales ÷ sessions", (g) => ratio(g("total_sales"), g("sessions"))),

  // ---------------- Costs ----------------
  derived("net_revenue", "Net revenue", "profit", "money", "shopify", "Total sales − net taxes", (g) => nz(g("total_sales")).minus(nz(g("net_taxes")))),
  sumMetric("cogs", "COGS", "costs", "money", "costs", "Units sold × the unit cost in force on the order date", false),
  derived("adjusted_cogs", "Adjusted COGS", "costs", "money", "costs", "COGS − cost of refunded units that were restocked", (g) =>
    nz(g("cogs")).minus(nz(g("refunded_restocked_cogs"))),
  false),
  sumMetric("shipping_cost", "Shipping cost", "costs", "money", "costs", "What you pay carriers: flat, table, or imported actuals per order", false),
  sumMetric("handling_fees", "Handling fees", "costs", "money", "costs", "Per-order plus per-item packing cost", false),
  sumMetric("payment_fees", "Payment fees", "costs", "money", "costs", "Actual Shopify Payments fee; other gateways % + fixed fee", false),
  sumMetric("cogs_missing_revenue", "Revenue without COGS", "costs", "money", "costs", "Revenue on lines whose SKU has no unit cost", false),
  sumMetric("cogs_missing_units", "Units without COGS", "costs", "number", "costs", "Units sold whose SKU has no unit cost", false),

  // ---------------- Ads ----------------
  sumMetric("ad_spend_meta", "Meta spend", "ads", "money", "meta", "Spend from Meta ad accounts mapped to the scope", false),
  sumMetric("ad_spend_google", "Google spend", "ads", "money", "blended", "Spend from Google Ads (coming soon)", false),
  sumMetric("ad_spend_tiktok", "TikTok spend", "ads", "money", "blended", "Spend from TikTok Ads (coming soon)", false),
  sumMetric("ad_spend_manual", "Manual ad spend", "ads", "money", "expenses", "Expenses flagged “counts as ad spend”", false),
  derived(
    "blended_ad_spend",
    "Blended ad spend",
    "ads",
    "money",
    "blended",
    "Spend from all ad platforms + manual ad spend",
    (g) => nz(g("ad_spend_meta")).plus(nz(g("ad_spend_google"))).plus(nz(g("ad_spend_tiktok"))).plus(nz(g("ad_spend_manual"))),
    false,
  ),
  derived("blended_roas", "Blended ROAS", "ads", "ratio", "blended", "Order revenue ÷ blended ad spend", (g) => ratio(g("order_revenue"), g("blended_ad_spend"))),
  derived("mer", "MER", "ads", "percent", "blended", "Blended ad spend ÷ order revenue", (g) => ratio(g("blended_ad_spend"), g("order_revenue")), false),
  derived("ncpa", "NCPA", "ads", "money", "blended", "Blended ad spend ÷ new customer orders", (g) => ratio(g("blended_ad_spend"), g("new_customer_orders")), false),
  derived("nc_roas", "NC-ROAS", "ads", "ratio", "blended", "New customer revenue ÷ blended ad spend", (g) => ratio(g("new_customer_revenue"), g("blended_ad_spend"))),
  sumMetric("meta_purchases", "Purchases (Meta)", "ads", "number", "meta", "Purchases attributed by Meta", true, "meta_purchases"),
  sumMetric("meta_purchase_value", "Purchase value (Meta)", "ads", "money", "meta", "Purchase value attributed by Meta"),
  derived("meta_roas", "ROAS (Meta-reported)", "ads", "ratio", "meta", "Purchase value ÷ spend", (g) => ratio(g("meta_purchase_value"), g("ad_spend_meta")), true, {
    platformReported: true,
  }),
  derived("meta_cpa", "CPA (Meta-reported)", "ads", "money", "meta", "Spend ÷ purchases", (g) => ratio(g("ad_spend_meta"), g("meta_purchases")), false, {
    platformReported: true,
  }),
  sumMetric("impressions", "Impressions", "ads", "number", "meta", "Ad impressions"),
  sumMetric("link_clicks", "Link clicks", "ads", "number", "meta", "Clicks on ad links"),
  derived("cpm", "CPM", "ads", "money", "meta", "Spend ÷ impressions × 1,000", (g) => {
    const r = ratio(g("ad_spend_meta"), g("impressions"));
    return r === null ? null : r.mul(1000);
  }, false),
  derived("ctr", "CTR", "ads", "percent", "meta", "Link clicks ÷ impressions", (g) => ratio(g("link_clicks"), g("impressions"))),
  derived("cpc", "CPC", "ads", "money", "meta", "Spend ÷ link clicks", (g) => ratio(g("ad_spend_meta"), g("link_clicks")), false),

  // ---------------- Expenses ----------------
  sumMetric("operating_expenses", "Operating expenses", "expenses", "money", "expenses", "Recurring and one-off expenses allocated to the scope, full amount on the charge date", false),

  // ---------------- Profit ----------------
  derived("gross_profit", "Gross profit", "profit", "money", "blended", "Net revenue − adjusted COGS", (g) => nz(g("net_revenue")).minus(nz(g("adjusted_cogs")))),
  derived(
    "contribution_margin",
    "Contribution margin",
    "profit",
    "money",
    "blended",
    "Gross profit − shipping cost − handling fees − payment fees",
    (g) => nz(g("gross_profit")).minus(nz(g("shipping_cost"))).minus(nz(g("handling_fees"))).minus(nz(g("payment_fees"))),
  ),
  derived(
    "net_profit",
    "Net profit",
    "profit",
    "money",
    "blended",
    "Contribution margin − blended ad spend − operating expenses",
    (g) => nz(g("contribution_margin")).minus(nz(g("blended_ad_spend"))).minus(nz(g("operating_expenses"))),
  ),
  derived("net_margin", "Net margin", "profit", "percent", "blended", "Net profit ÷ net revenue", (g) => ratio(g("net_profit"), g("net_revenue"))),
  derived(
    "profit_tax",
    "Profit tax",
    "profit",
    "money",
    "blended",
    "Net profit × profit tax rate (only when net profit is positive; setting, default 0)",
    (g, ctx) => {
      if (!ctx.profitTaxRate) return null;
      const p = nz(g("net_profit"));
      return p.gt(0) ? p.mul(ctx.profitTaxRate) : new Decimal(0);
    },
    false,
  ),
  derived(
    "profit_after_tax",
    "Profit after tax",
    "profit",
    "money",
    "blended",
    "Net profit − profit tax (shown only when a profit tax rate is set)",
    (g, ctx) => (ctx.profitTaxRate ? nz(g("net_profit")).minus(nz(g("profit_tax"))) : null),
  ),
  derived("break_even_roas", "Break-even ROAS", "profit", "ratio", "blended", "Order revenue ÷ contribution margin", (g) => {
    const cm = g("contribution_margin");
    if (cm === null || cm.lte(0)) return null;
    return ratio(g("order_revenue"), cm);
  }, false),
  derived("refund_rate", "Refund rate", "store", "percent", "shopify", "Refunded sales ÷ order revenue", (g) => ratio(g("sales_reversals"), g("order_revenue")), false),
];

export const METRIC_BY_ID: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.id, m]));

export const DEFAULT_PINS = ["total_sales", "net_profit", "blended_roas", "blended_ad_spend", "adjusted_cogs", "handling_fees", "conversion_rate"];

export const SECTION_LABELS: Record<MetricSection, string> = {
  store: "Store",
  web: "Web analytics",
  ads: "Ads",
  costs: "Costs",
  expenses: "Expenses",
  profit: "Profit",
};

/**
 * Evaluate every metric from a bag of summed components.
 * Components missing from the bag are treated as 0 (sum metrics) — except where a metric
 * is explicitly unavailable (e.g. sessions not connected), which callers signal by passing null.
 */
export function evaluate(
  components: Record<string, Decimal | string | number | null | undefined>,
  ctx: EvalContext = { profitTaxRate: 0 },
  ids: string[] = METRICS.map((m) => m.id),
): Record<string, Decimal | null> {
  const memo = new Map<string, Decimal | null>();
  const stack = new Set<string>();
  const get: Getter = (id) => {
    if (memo.has(id)) return memo.get(id)!;
    const def = METRIC_BY_ID[id];
    let value: Decimal | null;
    if (!def) {
      // raw component that has no registry entry (e.g. shipping_gross)
      const raw = components[id];
      value = raw === null ? null : D(raw);
    } else if (def.kind === "sum") {
      const raw = components[def.component!];
      value = raw === null ? null : D(raw);
    } else {
      if (stack.has(id)) throw new Error(`Metric cycle at ${id}`);
      stack.add(id);
      value = def.compute!(get, ctx);
      stack.delete(id);
    }
    memo.set(id, value);
    return value;
  };
  const out: Record<string, Decimal | null> = {};
  for (const id of ids) out[id] = get(id);
  return out;
}

/** Percent change from b to a; null when b is 0 or missing. */
export function change(a: Decimal | null, b: Decimal | null): number | null {
  if (a === null || b === null || b.isZero()) return null;
  return a.minus(b).div(b.abs()).toNumber();
}
