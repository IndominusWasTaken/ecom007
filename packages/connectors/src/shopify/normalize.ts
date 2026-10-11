/** Shopify API objects -> plain records ready for upsert. No customer PII is kept. */

type Money = { shopMoney?: { amount?: string | null; currencyCode?: string } | null } | null | undefined;
const amt = (m: Money): string => m?.shopMoney?.amount ?? "0";
const sumMoney = (list: { priceSet?: Money }[] | null | undefined): string =>
  (list ?? []).reduce((a, t) => a + Number(amt(t.priceSet)), 0).toFixed(6);

export interface LineRecord {
  shopifyId: string;
  productShopifyId: string | null;
  variantShopifyId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: string;
  discount: string;
  tax: string;
  requiresShipping: boolean;
  raw: unknown;
}

export interface RefundRecord {
  shopifyId: string;
  createdAt: string;
  note: string | null;
  totalRefunded: string;
  shippingAmount: string;
  shippingTax: string;
  otherAmount: string;
  lines: { shopifyId: string; orderLineShopifyId: string; quantity: number; subtotal: string; tax: string; restockType: string | null; restocked: boolean }[];
  raw: unknown;
}

export interface TxnRecord {
  shopifyId: string;
  kind: string;
  status: string;
  gateway: string;
  amount: string;
  currency: string;
  processedAt: string | null;
  test: boolean;
}

export interface OrderRecord {
  shopifyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  currency: string;
  presentmentCurrency: string | null;
  taxesIncluded: boolean;
  sourceName: string | null;
  channel: string | null;
  customerId: string | null;
  customerOrderIndex: number | null;
  shippingCountry: string | null;
  requiresShipping: boolean;
  totalWeightGrams: number;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  fulfilledAt: string | null;
  subtotal: string;
  totalDiscounts: string;
  shippingAmount: string;
  shippingTax: string;
  totalTax: string;
  totalPrice: string;
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };
  landingPage: string | null;
  lines: LineRecord[];
  transactions: TxnRecord[];
  /** null = refunds not fetched in this payload (need ORDER_DETAIL_QUERY). */
  refunds: RefundRecord[] | null;
  /** True when line items were truncated by the page limit. */
  linesTruncated: boolean;
  raw: unknown;
}

const nodesOf = <T>(c: any): T[] => (Array.isArray(c) ? c : c?.nodes ?? c?.edges?.map((e: any) => e.node) ?? []);

/** Strip customer details from the raw payload before it is stored. */
function scrub(o: any): unknown {
  const { customer, shippingAddress, ...rest } = o ?? {};
  return { ...rest, customer: customer ? { id: customer.id } : null, shippingAddress: shippingAddress ? { countryCodeV2: shippingAddress.countryCodeV2 } : null };
}

/**
 * Assumption (verify with reconciliation): refund line subtotals include tax when the order's
 * prices include tax; refund shipping subtotals always exclude tax.
 */
export function normalizeRefund(r: any, taxesIncluded = false): RefundRecord {
  const lines = nodesOf<any>(r.refundLineItems).map((l) => ({
    shopifyId: l.id,
    orderLineShopifyId: l.lineItem?.id,
    quantity: l.quantity ?? 0,
    subtotal: amt(l.subtotalSet),
    tax: amt(l.totalTaxSet),
    restockType: l.restockType ?? null,
    restocked: Boolean(l.restocked) || ["RETURN", "CANCEL"].includes(l.restockType),
  }));
  const ship = nodesOf<any>(r.refundShippingLines);
  const shippingAmount = ship.reduce((a, s) => a + Number(amt(s.subtotalAmountSet)), 0);
  const shippingTax = ship.reduce((a, s) => a + Number(amt(s.taxAmountSet)), 0);
  const linesTotal = lines.reduce((a, l) => a + Number(l.subtotal) + (taxesIncluded ? 0 : Number(l.tax)), 0);
  const total = Number(amt(r.totalRefundedSet));
  // Money refunded that is not tied to lines or shipping (goodwill refunds, adjustments).
  // subtotalAmountSet for shipping excludes tax, so shipping total = subtotal + tax.
  const other = Math.max(0, total - linesTotal - shippingAmount - shippingTax);
  return {
    shopifyId: r.id,
    createdAt: r.createdAt,
    note: r.note ?? null,
    totalRefunded: total.toFixed(6),
    shippingAmount: shippingAmount.toFixed(6),
    shippingTax: shippingTax.toFixed(6),
    otherAmount: other < 0.005 ? "0" : other.toFixed(6),
    lines,
    raw: r,
  };
}

export function normalizeOrder(o: any): OrderRecord {
  const lineNodes = nodesOf<any>(o.lineItems);
  const lines: LineRecord[] = lineNodes.map((l) => ({
    shopifyId: l.id,
    productShopifyId: l.product?.id ?? null,
    variantShopifyId: l.variant?.id ?? null,
    sku: l.sku || null,
    title: l.title ?? l.name ?? "",
    variantTitle: l.variantTitle ?? null,
    quantity: l.quantity ?? 0,
    unitPrice: amt(l.originalUnitPriceSet),
    discount: amt(l.totalDiscountSet),
    tax: sumMoney(l.taxLines),
    requiresShipping: l.requiresShipping ?? true,
    raw: l,
  }));
  const shipLines = nodesOf<any>(o.shippingLines);
  const shippingAmount = shipLines.length ? shipLines.reduce((a, s) => a + Number(amt(s.discountedPriceSet)), 0).toFixed(6) : amt(o.totalShippingPriceSet);
  const shippingTax = shipLines.reduce((a, s) => a + Number(sumMoney(s.taxLines)), 0).toFixed(6);
  const fulfillments = (o.fulfillments ?? []).filter((f: any) => f.status === "SUCCESS" || f.status === "success");
  const fulfilledAt = fulfillments.length ? fulfillments.map((f: any) => f.createdAt).sort()[0] : null;
  const utm = o.customerJourneySummary?.lastVisit?.utmParameters ?? {};
  const txns: TxnRecord[] = nodesOf<any>(o.transactions).map((t) => ({
    shopifyId: t.id,
    kind: t.kind,
    status: t.status,
    gateway: t.gateway ?? "unknown",
    amount: t.amountSet?.shopMoney?.amount ?? "0",
    currency: t.amountSet?.shopMoney?.currencyCode ?? o.currencyCode,
    processedAt: t.processedAt ?? null,
    test: Boolean(t.test),
  }));
  return {
    shopifyId: o.id,
    name: o.name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    cancelledAt: o.cancelledAt ?? null,
    test: Boolean(o.test),
    currency: o.totalPriceSet?.shopMoney?.currencyCode ?? o.currencyCode,
    presentmentCurrency: o.presentmentCurrencyCode ?? null,
    taxesIncluded: Boolean(o.taxesIncluded),
    sourceName: o.sourceName ?? null,
    channel: o.channelInformation?.channelDefinition?.channelName ?? o.sourceName ?? null,
    customerId: o.customer?.id ?? null,
    customerOrderIndex: o.customerJourneySummary?.customerOrderIndex ?? null,
    shippingCountry: o.shippingAddress?.countryCodeV2 ?? null,
    requiresShipping: o.requiresShipping ?? true,
    totalWeightGrams: Math.round(Number(o.totalWeight ?? 0)),
    financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null,
    fulfilledAt,
    subtotal: amt(o.subtotalPriceSet),
    totalDiscounts: amt(o.totalDiscountsSet),
    shippingAmount,
    shippingTax,
    totalTax: amt(o.totalTaxSet),
    totalPrice: amt(o.totalPriceSet),
    utm: { source: utm.source ?? null, medium: utm.medium ?? null, campaign: utm.campaign ?? null, content: utm.content ?? null, term: utm.term ?? null },
    landingPage: o.customerJourneySummary?.lastVisit?.landingPage ?? null,
    lines,
    transactions: txns,
    refunds: Array.isArray(o.refunds) ? o.refunds.map((r: any) => normalizeRefund(r, Boolean(o.taxesIncluded))) : null,
    linesTruncated: Boolean(o.lineItems?.pageInfo?.hasNextPage),
    raw: scrub({ ...o, lineItems: undefined, refunds: undefined, transactions: undefined }),
  };
}

/** Does this order need the detail query (refunds, or more lines than the page held)? */
export function needsDetail(o: OrderRecord): boolean {
  return o.linesTruncated || (o.refunds === null && /REFUND/i.test(o.financialStatus ?? ""));
}

/**
 * Reassemble bulk-operation JSONL: child objects (connections) come on their own lines
 * with __parentId. Returns top-level objects with children attached as { nodes: [] }.
 */
export function assembleBulk(jsonl: string, childKeyOf: (child: any) => string): any[] {
  const byId = new Map<string, any>();
  const roots: any[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.__parentId) {
      const parent = byId.get(obj.__parentId);
      if (!parent) continue;
      const key = childKeyOf(obj);
      parent[key] = parent[key] ?? { nodes: [] };
      parent[key].nodes.push(obj);
      if (obj.id) byId.set(obj.id, obj);
    } else {
      roots.push(obj);
      if (obj.id) byId.set(obj.id, obj);
    }
  }
  return roots;
}

/** Bulk child lines carry no typename by default: tell line items from shipping lines by shape. */
export function orderChildKey(child: any): string {
  if (typeof child.id === "string" && child.id.includes("/LineItem/")) return "lineItems";
  if ("discountedPriceSet" in child) return "shippingLines";
  return "other";
}

export function weightToGrams(w: { unit?: string; value?: number } | null | undefined): number | null {
  if (!w || w.value == null) return null;
  const f: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 };
  return Math.round(w.value * (f[w.unit ?? "GRAMS"] ?? 1));
}

/** ShopifyQL rows come back as objects or arrays depending on version; accept both. */
export function shopifyqlRows(table: { columns: { name: string }[]; rows: unknown } | null | undefined): Record<string, unknown>[] {
  if (!table) return [];
  let rows = table.rows as unknown;
  if (typeof rows === "string") rows = JSON.parse(rows);
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (Array.isArray(r) ? Object.fromEntries(table.columns.map((c, i) => [c.name, r[i]])) : (r as Record<string, unknown>)));
}
