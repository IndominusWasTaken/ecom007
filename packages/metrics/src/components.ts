/**
 * Components are the additive building blocks stored per store, per day, per display
 * currency in daily_store_metrics. Every metric in the registry is either one of these
 * (summed over the scope and range) or a formula over them. Ratios are never stored:
 * they are recomputed from summed parts for each scope and date range.
 */
export const MONEY_COMPONENTS = [
  // Sales, on the order date
  "gross_sales",
  "discounts",
  "shipping_gross", // shipping paid by customers on orders placed (ex tax)
  "order_taxes", // tax collected on orders placed
  "order_revenue", // gross − discounts + shipping + taxes, before refunds
  "new_customer_revenue",
  "returning_customer_revenue",
  // Refunds, on the refund date
  "sales_reversals",
  "shipping_refunded",
  "tax_refunded",
  "return_fees",
  // Costs
  "cogs",
  "refunded_restocked_cogs",
  "shipping_cost",
  "handling_fees",
  "payment_fees",
  "cogs_missing_revenue", // revenue on lines with no known unit cost
  // Ads
  "ad_spend_meta",
  "ad_spend_google",
  "ad_spend_tiktok",
  "ad_spend_manual",
  "meta_purchase_value",
  // Expenses (cash basis, allocated)
  "operating_expenses",
] as const;

export const COUNT_COMPONENTS = [
  "orders",
  "non_zero_orders",
  "units_sold",
  "new_customer_orders",
  "returning_customer_orders",
  "orders_fulfilled",
  "cogs_missing_units",
  "sessions",
  "added_to_cart",
  "reached_checkout",
  "completed_checkout",
  "meta_purchases",
  "impressions",
  "link_clicks",
  "clicks",
] as const;

/** Not additive across days: computed with COUNT(DISTINCT) over the orders table for the range. */
export const DISTINCT_COMPONENTS = ["new_customers", "returning_customers"] as const;

export type MoneyComponent = (typeof MONEY_COMPONENTS)[number];
export type CountComponent = (typeof COUNT_COMPONENTS)[number];
export type DistinctComponent = (typeof DISTINCT_COMPONENTS)[number];
export type ComponentId = MoneyComponent | CountComponent | DistinctComponent;

export const ALL_ADDITIVE: readonly (MoneyComponent | CountComponent)[] = [...MONEY_COMPONENTS, ...COUNT_COMPONENTS];

export function isMoneyComponent(id: string): id is MoneyComponent {
  return (MONEY_COMPONENTS as readonly string[]).includes(id);
}
