import { describe, expect, it } from "vitest";
import { normalizeOrder, assembleBulk, orderChildKey, needsDetail, shopifyqlRows } from "../src/shopify/normalize";
import { normalizeInsight, describeCreative, _dates } from "../src/meta/index";
import { parseEcbXml } from "../src/fx/ecb";

const order = {
  id: "gid://shopify/Order/1",
  name: "#1001",
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  test: false,
  taxesIncluded: true,
  currencyCode: "EUR",
  displayFinancialStatus: "PARTIALLY_REFUNDED",
  totalWeight: 500,
  customer: { id: "gid://shopify/Customer/9", email: "x@example.com", firstName: "X" },
  shippingAddress: { countryCodeV2: "BG", address1: "secret street" },
  totalPriceSet: { shopMoney: { amount: "66.00", currencyCode: "EUR" } },
  totalTaxSet: { shopMoney: { amount: "11.00" } },
  totalShippingPriceSet: { shopMoney: { amount: "6.00" } },
  shippingLines: { nodes: [{ discountedPriceSet: { shopMoney: { amount: "6.00" } }, taxLines: [{ priceSet: { shopMoney: { amount: "1.00" } } }] }] },
  lineItems: {
    pageInfo: { hasNextPage: false },
    nodes: [{ id: "gid://shopify/LineItem/5", sku: "BG-1", title: "Serum", quantity: 2, originalUnitPriceSet: { shopMoney: { amount: "30.00" } }, totalDiscountSet: { shopMoney: { amount: "0" } }, taxLines: [{ priceSet: { shopMoney: { amount: "10.00" } } }], variant: { id: "v" }, product: { id: "p" } }],
  },
  transactions: [{ id: "t1", kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", amountSet: { shopMoney: { amount: "66.00", currencyCode: "EUR" } } }],
  customerJourneySummary: { customerOrderIndex: 0, lastVisit: { utmParameters: { source: "facebook", campaign: "c1", content: "ad123" } } },
};

describe("shopify normalize", () => {
  it("maps an order and strips customer PII from raw", () => {
    const r = normalizeOrder(order);
    expect(r.customerId).toBe("gid://shopify/Customer/9");
    expect(r.shippingCountry).toBe("BG");
    expect(r.shippingTax).toBe("1.000000");
    expect(r.lines[0].tax).toBe("10.000000");
    expect(r.utm.content).toBe("ad123");
    expect(JSON.stringify(r.raw)).not.toContain("example.com");
    expect(JSON.stringify(r.raw)).not.toContain("secret street");
    expect(needsDetail(r)).toBe(true); // refunded but refunds not fetched
  });
  it("reassembles bulk JSONL", () => {
    const jsonl = [
      JSON.stringify({ id: "gid://shopify/Order/1", name: "#1" }),
      JSON.stringify({ id: "gid://shopify/LineItem/1", quantity: 1, __parentId: "gid://shopify/Order/1" }),
      JSON.stringify({ discountedPriceSet: { shopMoney: { amount: "5" } }, __parentId: "gid://shopify/Order/1" }),
    ].join("\n");
    const roots = assembleBulk(jsonl, orderChildKey);
    expect(roots[0].lineItems.nodes).toHaveLength(1);
    expect(roots[0].shippingLines.nodes).toHaveLength(1);
  });
  it("reads ShopifyQL rows as arrays or objects", () => {
    expect(shopifyqlRows({ columns: [{ name: "day" }, { name: "sessions" }], rows: [["2026-10-01", 5]] })).toEqual([{ day: "2026-10-01", sessions: 5 }]);
    expect(shopifyqlRows({ columns: [], rows: [{ day: "x" }] })).toEqual([{ day: "x" }]);
  });
});

describe("meta normalize", () => {
  it("prefers omni actions and does not double count", () => {
    const r = normalizeInsight({
      ad_id: "1",
      date_start: "2026-10-01",
      spend: "12.5",
      impressions: "1000",
      inline_link_clicks: "20",
      actions: [
        { action_type: "omni_purchase", value: "2" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
        { action_type: "video_view", value: "300" },
      ],
      action_values: [{ action_type: "omni_purchase", value: "80" }],
      video_thruplay_watched_actions: [{ action_type: "video_view", value: "60" }],
    });
    expect(r.purchases).toBe(2);
    expect(r.purchaseValue).toBe("80");
    expect(r.video3sPlays).toBe(300);
    expect(r.thruplays).toBe(60);
  });
  it("groups creatives by video or image", () => {
    expect(describeCreative({ id: "c", video_id: "v1" })?.groupKey).toBe("video:v1");
    expect(describeCreative({ id: "c", image_hash: "h" })?.format).toBe("image");
    expect(describeCreative({ id: "c", object_story_spec: { link_data: { child_attachments: [{ picture: "a" }, { picture: "b" }] } } })?.format).toBe("carousel");
  });
  it("month helpers", () => {
    expect(_dates.nextMonth("2026-12-01")).toBe("2027-01-01");
    expect(_dates.endOfMonth("2026-02-01")).toBe("2026-02-28");
  });
});

describe("ecb", () => {
  it("parses the reference rate XML", () => {
    const xml = `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="x"><Cube><Cube time="2026-10-09"><Cube currency="USD" rate="1.1612"/><Cube currency="BGN" rate="1.9558"/></Cube><Cube time="2026-10-08"><Cube currency="USD" rate="1.1650"/></Cube></Cube></gesmes:Envelope>`;
    expect(parseEcbXml(xml, ["USD"])).toEqual([
      { date: "2026-10-09", currency: "USD", perEur: "1.1612" },
      { date: "2026-10-08", currency: "USD", perEur: "1.1650" },
    ]);
  });
});
