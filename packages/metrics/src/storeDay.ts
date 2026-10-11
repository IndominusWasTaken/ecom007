import { D, Decimal, type DecimalLike } from "@ecom/core/money";
import { ALL_ADDITIVE, type CountComponent, type MoneyComponent } from "./components";
import { orderSales, refundEffect, type NOrder, type NRefund } from "./orders";

export type ComponentBag = Record<MoneyComponent | CountComponent, Decimal>;

export function emptyBag(): ComponentBag {
  return Object.fromEntries(ALL_ADDITIVE.map((k) => [k, new Decimal(0)])) as ComponentBag;
}

export function addBags(a: ComponentBag, b: Partial<Record<string, DecimalLike>>): ComponentBag {
  for (const k of ALL_ADDITIVE) if (b[k] !== undefined && b[k] !== null) a[k] = a[k].plus(D(b[k]));
  return a;
}

export interface PerOrderCosts {
  shippingCost: DecimalLike;
  handlingFee: DecimalLike;
  paymentFee: DecimalLike;
}

export interface StoreDayInput {
  date: string;
  /** Non-test orders whose local order date is `date`. */
  orders: NOrder[];
  /** Per-order operational costs, keyed by order id (orders placed on `date`). */
  orderCosts: Record<string, PerOrderCosts>;
  /** Refunds whose local refund date is `date`. */
  refunds: NRefund[];
  /** Count of orders whose fulfilment local date is `date`. */
  ordersFulfilled: number;
  sessions?: { sessions: number; addedToCart: number; reachedCheckout: number; completedCheckout: number } | null;
  ads?: Partial<Record<"ad_spend_meta" | "ad_spend_google" | "ad_spend_tiktok" | "meta_purchase_value" | "meta_purchases" | "impressions" | "link_clicks" | "clicks", DecimalLike>>;
  /** Expenses allocated to this store on this date, split by whether they count as ad spend. */
  expenses?: { operating: DecimalLike; adSpend: DecimalLike };
}

/** All additive components for one store on one day, in the store's currency. */
export function computeStoreDay(input: StoreDayInput): ComponentBag {
  const b = emptyBag();
  for (const o of input.orders) {
    if (o.test) continue;
    const s = orderSales(o);
    b.orders = b.orders.plus(1);
    if (s.revenue.gt(0)) b.non_zero_orders = b.non_zero_orders.plus(1);
    b.gross_sales = b.gross_sales.plus(s.gross);
    b.discounts = b.discounts.plus(s.discounts);
    b.shipping_gross = b.shipping_gross.plus(s.shipping);
    b.order_taxes = b.order_taxes.plus(s.taxes);
    b.order_revenue = b.order_revenue.plus(s.revenue);
    b.units_sold = b.units_sold.plus(s.units);
    b.cogs = b.cogs.plus(s.cogs);
    b.cogs_missing_units = b.cogs_missing_units.plus(s.missingCostUnits);
    b.cogs_missing_revenue = b.cogs_missing_revenue.plus(s.missingCostRevenue);
    if (o.isFirstOrder) {
      b.new_customer_orders = b.new_customer_orders.plus(1);
      b.new_customer_revenue = b.new_customer_revenue.plus(s.revenue);
    } else if (o.customerId) {
      b.returning_customer_orders = b.returning_customer_orders.plus(1);
      b.returning_customer_revenue = b.returning_customer_revenue.plus(s.revenue);
    }
    const c = input.orderCosts[o.id];
    if (c) {
      b.shipping_cost = b.shipping_cost.plus(D(c.shippingCost));
      b.handling_fees = b.handling_fees.plus(D(c.handlingFee));
      b.payment_fees = b.payment_fees.plus(D(c.paymentFee));
    }
  }
  for (const r of input.refunds) {
    const e = refundEffect(r);
    b.sales_reversals = b.sales_reversals.plus(e.salesReversals);
    b.shipping_refunded = b.shipping_refunded.plus(e.shippingRefunded);
    b.tax_refunded = b.tax_refunded.plus(e.taxRefunded);
    b.return_fees = b.return_fees.plus(e.returnFees);
    b.refunded_restocked_cogs = b.refunded_restocked_cogs.plus(e.restockedCogs);
  }
  b.orders_fulfilled = new Decimal(input.ordersFulfilled);
  if (input.sessions) {
    b.sessions = new Decimal(input.sessions.sessions);
    b.added_to_cart = new Decimal(input.sessions.addedToCart);
    b.reached_checkout = new Decimal(input.sessions.reachedCheckout);
    b.completed_checkout = new Decimal(input.sessions.completedCheckout);
  }
  if (input.ads) addBags(b, input.ads);
  if (input.expenses) {
    b.operating_expenses = b.operating_expenses.plus(D(input.expenses.operating));
    b.ad_spend_manual = b.ad_spend_manual.plus(D(input.expenses.adSpend));
  }
  return b;
}

/** Convert the money components of a bag with a single factor (store ccy -> display ccy). */
export function convertBag(b: ComponentBag, factor: Decimal, moneyKeys: readonly string[]): ComponentBag {
  const out = { ...b };
  for (const k of moneyKeys) (out as Record<string, Decimal>)[k] = b[k as MoneyComponent].mul(factor);
  return out;
}
