import { describe, expect, it } from "vitest";
import { resolveUnitCost, shippingCost, handlingFee, paymentFee, inForce } from "../src/costs";
import { mapCampaignToStore, deriveAd, emptyAdTotals, addAdTotals } from "../src/ads";

describe("unit cost resolution", () => {
  const typed = [
    { effectiveFrom: "2026-01-01", cost: "5.00" },
    { effectiveFrom: "2026-06-01", cost: "6.00" },
  ];
  it("uses the cost in force on the order date", () => {
    expect(resolveUnitCost("2026-05-31", { typed, shopifyCost: "9", fallbackPercent: 30, unitPriceExTax: 20 }).cost?.toFixed(2)).toBe("5.00");
    expect(resolveUnitCost("2026-06-01", { typed, shopifyCost: "9", fallbackPercent: 30, unitPriceExTax: 20 }).cost?.toFixed(2)).toBe("6.00");
  });
  it("falls back to Shopify, then %, then missing", () => {
    expect(resolveUnitCost("2025-12-31", { typed, shopifyCost: "9", fallbackPercent: 30, unitPriceExTax: 20 })).toMatchObject({ source: "shopify" });
    const f = resolveUnitCost("2025-12-31", { typed, shopifyCost: null, fallbackPercent: 30, unitPriceExTax: 20 });
    expect(f.source).toBe("fallback");
    expect(f.cost?.toFixed(2)).toBe("6.00");
    expect(resolveUnitCost("2025-12-31", { typed, shopifyCost: null, fallbackPercent: null, unitPriceExTax: 20 })).toEqual({ cost: null, source: "missing" });
  });
  it("inForce picks latest effective row", () => {
    expect(inForce(typed, "2026-12-01")?.cost).toBe("6.00");
    expect(inForce(typed, "2025-01-01")).toBeNull();
  });
});

describe("shipping, handling, payment fees", () => {
  const rules = [
    { effectiveFrom: "2026-01-01", mode: "flat" as const, flatAmount: "4.50" },
    {
      effectiveFrom: "2026-07-01",
      mode: "table" as const,
      flatAmount: "7.00",
      table: [
        { country: "US", basis: "items" as const, min: 1, max: 2, amount: "5.00" },
        { country: "US", basis: "items" as const, min: 3, max: null, amount: "8.00" },
        { country: "*", basis: "items" as const, min: 1, max: null, amount: "12.00" },
      ],
    },
  ];
  const f = (o: Partial<Parameters<typeof shippingCost>[2]> = {}) => ({ country: "US", weightGrams: 300, items: 1, actual: null, requiresShipping: true, ...o });
  it("flat before the table rule took effect", () => expect(shippingCost(rules, "2026-06-30", f()).toFixed(2)).toBe("4.50"));
  it("table by country and item count", () => {
    expect(shippingCost(rules, "2026-07-01", f({ items: 2 })).toFixed(2)).toBe("5.00");
    expect(shippingCost(rules, "2026-07-01", f({ items: 5 })).toFixed(2)).toBe("8.00");
    expect(shippingCost(rules, "2026-07-01", f({ country: "DE" })).toFixed(2)).toBe("12.00");
  });
  it("imported actual overrides rules", () => expect(shippingCost(rules, "2026-07-01", f({ actual: "3.21" })).toFixed(2)).toBe("3.21"));
  it("digital orders cost nothing to ship", () => expect(shippingCost(rules, "2026-07-01", f({ requiresShipping: false })).toFixed(2)).toBe("0.00"));

  it("handling per order plus per item", () => {
    expect(handlingFee([{ effectiveFrom: "2026-01-01", perOrder: "1.00", perItem: "0.25" }], "2026-02-01", 4).toFixed(2)).toBe("2.00");
    expect(handlingFee([], "2026-02-01", 4).toFixed(2)).toBe("0.00");
  });

  it("payment fees: actual first, then gateway rule, then wildcard", () => {
    const pr = [
      { effectiveFrom: "2026-01-01", gateway: "paypal", percent: "3.49", fixed: "0.49" },
      { effectiveFrom: "2026-01-01", gateway: "*", percent: "2", fixed: "0" },
    ];
    expect(paymentFee(pr, "2026-02-01", { gateway: "shopify_payments", amount: 100, actualFee: "3.20" }).toFixed(2)).toBe("3.20");
    expect(paymentFee(pr, "2026-02-01", { gateway: "PayPal", amount: 100, actualFee: null }).toFixed(2)).toBe("3.98");
    expect(paymentFee(pr, "2026-02-01", { gateway: "Cash on Delivery (COD)", amount: 100, actualFee: null }).toFixed(2)).toBe("2.00");
  });
});

describe("ads", () => {
  it("maps campaigns with rules, account default, else unassigned", () => {
    const rules = [{ adAccountId: 1, pattern: "BG", storeId: 2, priority: 1 }, { adAccountId: null, pattern: "/^us[-_ ]/i", storeId: 1, priority: 2 }];
    expect(mapCampaignToStore({ id: "c1", name: "Serum BG – broad", adAccountId: 1 }, 1, rules)).toBe(2);
    expect(mapCampaignToStore({ id: "c2", name: "US_test", adAccountId: 7 }, null, rules)).toBe(1);
    expect(mapCampaignToStore({ id: "c3", name: "Other", adAccountId: 1 }, 1, rules)).toBe(1);
    expect(mapCampaignToStore({ id: "c4", name: "Other", adAccountId: 7 }, null, rules)).toBeNull();
  });
  it("derives ratios from sums", () => {
    const t = addAdTotals(addAdTotals(emptyAdTotals(), { spend: 10, impressions: 1000, link_clicks: 20, purchases: 1, purchase_value: 40, video_3s_plays: 300, thruplays: 60, reach: 500 }), { spend: 30, impressions: 3000, link_clicks: 30, purchases: 1, purchase_value: 40 });
    const d = deriveAd(t);
    expect(d.roas?.toFixed(2)).toBe("2.00");
    expect(d.cpa?.toFixed(2)).toBe("20.00");
    expect(d.cpm?.toFixed(2)).toBe("10.00");
    expect(d.ctr?.toFixed(4)).toBe("0.0125");
    expect(d.hook_rate?.toFixed(4)).toBe("0.0750");
    expect(d.hold_rate?.toFixed(2)).toBe("0.20");
  });
});
