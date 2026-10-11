import { describe, expect, it } from "vitest";
import { Decimal } from "@ecom/core/money";
import { FxTable } from "@ecom/core/fx";
import { computeStoreDay, addBags, emptyBag, convertBag } from "../src/storeDay";
import { evaluate, METRICS, change } from "../src/registry";
import { orderSales, refundEffect, lineSales } from "../src/orders";
import { MONEY_COMPONENTS } from "../src/components";
import { bgOrders, bgPartialRefund, usFullRefund, usOrders, usPartialRefund } from "./fixtures";

const s = (d: Decimal | null) => (d === null ? null : d.toFixed(2));

describe("order sales", () => {
  it("plain order: gross, shipping, tax, revenue", () => {
    const r = orderSales(usOrders[0]);
    expect(r.gross.toFixed(2)).toBe("90.00");
    expect(r.discounts.toFixed(2)).toBe("0.00");
    expect(r.shipping.toFixed(2)).toBe("5.00");
    expect(r.taxes.toFixed(2)).toBe("7.20");
    expect(r.revenue.toFixed(2)).toBe("102.20");
    expect(r.cogs.toFixed(2)).toBe("28.00");
    expect(r.units).toBe(3);
  });

  it("discount is subtracted once", () => {
    const r = orderSales(usOrders[1]);
    expect(r.gross.toFixed(2)).toBe("100.00");
    expect(r.discounts.toFixed(2)).toBe("10.00");
    expect(r.revenue.toFixed(2)).toBe("97.20");
  });

  it("zero-value order has zero revenue but still counts cost", () => {
    const r = orderSales(usOrders[2]);
    expect(r.revenue.toFixed(2)).toBe("0.00");
    expect(r.cogs.toFixed(2)).toBe("12.00");
  });

  it("tax-inclusive order strips VAT from gross, discount and shipping", () => {
    const r = orderSales(bgOrders[0]);
    expect(r.gross.toFixed(2)).toBe("50.00");
    expect(r.shipping.toFixed(2)).toBe("5.00");
    expect(r.taxes.toFixed(2)).toBe("11.00");
    // revenue equals what the customer paid
    expect(r.revenue.toFixed(2)).toBe("66.00");
    const l = lineSales(bgOrders[1].lines[0], true);
    // 24 incl, 6 discount, 3 VAT -> gross 20, discount 5 (ex VAT)
    expect(l.gross.toFixed(2)).toBe("20.00");
    expect(l.discount.toFixed(2)).toBe("5.00");
  });

  it("missing unit cost is reported, not guessed", () => {
    const r = orderSales(bgOrders[1]);
    expect(r.cogs.toFixed(2)).toBe("0.00");
    expect(r.missingCostUnits).toBe(1);
    expect(r.missingCostRevenue.toFixed(2)).toBe("15.00");
  });
});

describe("refunds", () => {
  it("full refund reverses sales and tax and returns restocked cost", () => {
    const e = refundEffect(usFullRefund);
    expect(e.salesReversals.toFixed(2)).toBe("90.00");
    expect(e.taxRefunded.toFixed(2)).toBe("7.20");
    expect(e.restockedCogs.toFixed(2)).toBe("32.00");
  });
  it("partial refund, not restocked, includes shipping refund", () => {
    const e = refundEffect(usPartialRefund);
    expect(e.salesReversals.toFixed(2)).toBe("25.00");
    expect(e.shippingRefunded.toFixed(2)).toBe("5.00");
    expect(e.restockedCogs.toFixed(2)).toBe("0.00");
  });
  it("tax-inclusive refund excludes VAT from reversal", () => {
    const e = refundEffect(bgPartialRefund);
    expect(e.salesReversals.toFixed(2)).toBe("25.00");
    expect(e.taxRefunded.toFixed(2)).toBe("5.00");
    expect(e.restockedCogs.toFixed(2)).toBe("9.00");
  });
});

describe("store-day components and registry formulas", () => {
  const day1 = computeStoreDay({
    date: "2026-09-01",
    orders: usOrders,
    orderCosts: {
      "us-1001": { shippingCost: "4.00", handlingFee: "1.50", paymentFee: "3.26" },
      "us-1002": { shippingCost: "4.00", handlingFee: "1.50", paymentFee: "3.12" },
      "us-1003": { shippingCost: "4.00", handlingFee: "1.50", paymentFee: "0" },
    },
    refunds: [],
    ordersFulfilled: 2,
    sessions: { sessions: 200, addedToCart: 20, reachedCheckout: 10, completedCheckout: 3 },
    ads: { ad_spend_meta: "50.00", meta_purchase_value: "150.00", meta_purchases: 2, impressions: 10000, link_clicks: 150 },
    expenses: { operating: "10.00", adSpend: "0" },
  });

  it("counts orders, excluding the test order", () => {
    expect(day1.orders.toNumber()).toBe(3);
    expect(day1.non_zero_orders.toNumber()).toBe(2);
    expect(day1.new_customer_orders.toNumber()).toBe(2);
    expect(day1.returning_customer_orders.toNumber()).toBe(1);
    expect(day1.units_sold.toNumber()).toBe(8);
  });

  it("evaluates every metric in the registry", () => {
    const m = evaluate({ ...day1, new_customers: 2, returning_customers: 1 });
    expect(s(m.gross_sales)).toBe("230.00");
    expect(s(m.discounts)).toBe("50.00");
    expect(s(m.net_sales)).toBe("180.00");
    expect(s(m.shipping_charges)).toBe("5.00");
    expect(s(m.sale_taxes)).toBe("14.40");
    expect(s(m.net_taxes)).toBe("14.40");
    expect(s(m.total_sales)).toBe("199.40");
    expect(s(m.order_revenue)).toBe("199.40");
    expect(s(m.net_revenue)).toBe("185.00");
    expect(s(m.aov)).toBe(new Decimal("199.40").minus(5).minus("14.40").div(3).toFixed(2));
    expect(s(m.true_aov)).toBe("90.00");
    expect(s(m.cogs)).toBe("72.00");
    expect(s(m.adjusted_cogs)).toBe("72.00");
    expect(s(m.gross_profit)).toBe("113.00");
    expect(s(m.contribution_margin)).toBe(new Decimal(113).minus(12).minus("4.5").minus("6.38").toFixed(2));
    expect(s(m.blended_ad_spend)).toBe("50.00");
    expect(s(m.net_profit)).toBe(new Decimal("90.12").minus(50).minus(10).toFixed(2));
    expect(s(m.blended_roas)).toBe(new Decimal("199.40").div(50).toFixed(2));
    expect(s(m.mer)).toBe(new Decimal(50).div("199.40").toFixed(2));
    expect(s(m.ncpa)).toBe("25.00");
    expect(s(m.conversion_rate)).toBe("0.02");
    expect(s(m.new_customers_pct)).toBe("0.67");
    expect(s(m.meta_roas)).toBe("3.00");
    expect(s(m.cpm)).toBe("5.00");
    expect(m.profit_after_tax).toBeNull();
    for (const def of METRICS) expect(def.id in m).toBe(true);
  });

  it("refunds land on the refund date, not the order date", () => {
    const day3 = computeStoreDay({ date: "2026-09-03", orders: [], orderCosts: {}, refunds: [usFullRefund, usPartialRefund], ordersFulfilled: 0 });
    const m = evaluate(day3);
    expect(s(m.sales_reversals)).toBe("115.00");
    expect(s(m.shipping_charges)).toBe("-5.00");
    expect(s(m.net_taxes)).toBe("-9.20");
    expect(s(m.total_sales)).toBe("-129.20");
    expect(s(m.adjusted_cogs)).toBe("-32.00");
    expect(m.orders?.toNumber()).toBe(0);
  });

  it("profit tax is applied only when set and only to positive profit", () => {
    const m = evaluate({ ...day1 }, { profitTaxRate: 0.1 });
    expect(s(m.profit_tax)).toBe(m.net_profit!.mul(0.1).toFixed(2));
    expect(s(m.profit_after_tax)).toBe(m.net_profit!.mul(0.9).toFixed(2));
    const loss = evaluate({ ...day1, ad_spend_meta: 1000 }, { profitTaxRate: 0.1 });
    expect(s(loss.profit_tax)).toBe("0.00");
  });

  it("ratios are recomputed from parts, never averaged", () => {
    const a = emptyBag();
    a.order_revenue = new Decimal(100);
    a.ad_spend_meta = new Decimal(10); // ROAS 10
    const b = emptyBag();
    b.order_revenue = new Decimal(100);
    b.ad_spend_meta = new Decimal(90); // ROAS 1.11
    const combined = addBags(addBags(emptyBag(), a), b);
    expect(s(evaluate(combined).blended_roas)).toBe("2.00"); // 200/100, not (10+1.11)/2
  });
});

describe("currencies and the All = sum of stores identity", () => {
  const fx = new FxTable(new Map([["2026-09-01", { USD: "1.10" }]]));
  const us = computeStoreDay({ date: "2026-09-01", orders: usOrders, orderCosts: {}, refunds: [], ordersFulfilled: 0 });
  const bg = computeStoreDay({ date: "2026-09-01", orders: bgOrders, orderCosts: {}, refunds: [bgPartialRefund], ordersFulfilled: 0 });

  it("never adds different currencies: converts each store first", () => {
    const bgUsd = convertBag(bg, fx.perEur("USD", "2026-09-01"), MONEY_COMPONENTS);
    expect(bgUsd.order_revenue.toFixed(2)).toBe(new Decimal(84).mul("1.10").toFixed(2));
    const usEur = convertBag(us, new Decimal(1).div(fx.perEur("USD", "2026-09-01")), MONEY_COMPONENTS);
    expect(usEur.order_revenue.toFixed(4)).toBe(new Decimal("199.40").div("1.10").toFixed(4));
  });

  it("All equals the sum of the stores for every sum metric", () => {
    const usUsd = us;
    const bgUsd = convertBag(bg, fx.perEur("USD", "2026-09-01"), MONEY_COMPONENTS);
    const all = addBags(addBags(emptyBag(), usUsd), bgUsd);
    const mAll = evaluate(all);
    const mUs = evaluate(usUsd);
    const mBg = evaluate(bgUsd);
    for (const def of METRICS) {
      const isAdditive =
        def.kind === "sum" ||
        ["net_sales", "shipping_charges", "net_taxes", "total_sales", "net_revenue", "adjusted_cogs", "blended_ad_spend", "gross_profit", "contribution_margin", "net_profit"].includes(def.id);
      if (!isAdditive) continue;
      const a = mAll[def.id] ?? new Decimal(0);
      const b = (mUs[def.id] ?? new Decimal(0)).plus(mBg[def.id] ?? new Decimal(0));
      expect(a.toFixed(6), def.id).toBe(b.toFixed(6));
    }
  });
});

describe("change", () => {
  it("handles zero baselines", () => {
    expect(change(new Decimal(10), new Decimal(0))).toBeNull();
    expect(change(new Decimal(15), new Decimal(10))).toBeCloseTo(0.5);
    expect(change(new Decimal(-5), new Decimal(-10))).toBeCloseTo(0.5);
  });
});
