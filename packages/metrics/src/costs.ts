import { D, Decimal, type DecimalLike } from "@ecom/core/money";

/** A dated value: the row with the latest effectiveFrom <= date wins. */
export interface Dated {
  effectiveFrom: string;
}

export function inForce<T extends Dated>(rows: T[], date: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best;
}

export type CostSource = "typed" | "shopify" | "fallback" | "missing";

export interface UnitCostInputs {
  /** Typed costs for this variant/SKU, already converted to the store currency for the date. */
  typed: (Dated & { cost: DecimalLike })[];
  /** Shopify "cost per item" for the variant, store currency. */
  shopifyCost: DecimalLike | null;
  /** Store fallback: % of unit price when nothing else is known (e.g. 30 = 30%). */
  fallbackPercent: number | null;
  unitPriceExTax: DecimalLike;
}

/** Typed value always wins; then Shopify's cost per item; then the store's % fallback. */
export function resolveUnitCost(date: string, i: UnitCostInputs): { cost: Decimal | null; source: CostSource } {
  const t = inForce(i.typed, date);
  if (t) return { cost: D(t.cost), source: "typed" };
  if (i.shopifyCost !== null && i.shopifyCost !== undefined && D(i.shopifyCost).gt(0)) return { cost: D(i.shopifyCost), source: "shopify" };
  if (i.fallbackPercent !== null && i.fallbackPercent > 0) {
    return { cost: D(i.unitPriceExTax).mul(i.fallbackPercent).div(100), source: "fallback" };
  }
  return { cost: null, source: "missing" };
}

// ---------------- Shipping ----------------

export type ShippingMode = "flat" | "table" | "actual";

export interface ShippingRule extends Dated {
  mode: ShippingMode;
  /** Flat cost per order (mode flat), or the default when no table row matches. */
  flatAmount: DecimalLike;
  /** Table rows (mode table). countries: ISO codes, "*" = any. basis: weight in grams or item count. */
  table?: { country: string; basis: "weight" | "items"; min: number; max: number | null; amount: DecimalLike }[];
}

export interface ShippingOrderFacts {
  country: string | null;
  weightGrams: number;
  items: number;
  /** Imported actual cost for this order, store currency. Overrides every rule. */
  actual: DecimalLike | null;
  requiresShipping: boolean;
}

export function shippingCost(rules: ShippingRule[], date: string, f: ShippingOrderFacts): Decimal {
  if (f.actual !== null && f.actual !== undefined && f.actual !== "") return D(f.actual);
  if (!f.requiresShipping) return new Decimal(0);
  const rule = inForce(rules, date);
  if (!rule) return new Decimal(0);
  if (rule.mode === "table" && rule.table?.length) {
    const candidates = rule.table.filter((r) => r.country === "*" || (f.country && r.country.toUpperCase() === f.country.toUpperCase()));
    // country-specific rows beat the wildcard
    candidates.sort((a, b) => (a.country === "*" ? 1 : 0) - (b.country === "*" ? 1 : 0));
    for (const r of candidates) {
      const v = r.basis === "weight" ? f.weightGrams : f.items;
      if (v >= r.min && (r.max === null || v <= r.max)) return D(r.amount);
    }
  }
  // "actual" mode with no import yet, or no table match: fall back to the flat amount
  return D(rule.flatAmount);
}

// ---------------- Handling ----------------

export interface HandlingRule extends Dated {
  perOrder: DecimalLike;
  perItem: DecimalLike;
}

export function handlingFee(rules: HandlingRule[], date: string, items: number): Decimal {
  const r = inForce(rules, date);
  if (!r) return new Decimal(0);
  return D(r.perOrder).plus(D(r.perItem).mul(items));
}

// ---------------- Payment fees ----------------

export interface PaymentFeeRule extends Dated {
  gateway: string; // lowercased gateway name, "*" = any other gateway
  percent: DecimalLike; // e.g. 2.9
  fixed: DecimalLike; // per transaction, store currency
}

export interface PaymentTxn {
  gateway: string;
  amount: DecimalLike;
  /** Actual fee from Shopify Payments balance transactions, when known. */
  actualFee: DecimalLike | null;
}

export function paymentFee(rules: PaymentFeeRule[], date: string, txn: PaymentTxn): Decimal {
  if (txn.actualFee !== null && txn.actualFee !== undefined && txn.actualFee !== "") return D(txn.actualFee);
  const gw = txn.gateway.toLowerCase();
  const specific = inForce(rules.filter((r) => r.gateway.toLowerCase() === gw), date);
  const rule = specific ?? inForce(rules.filter((r) => r.gateway === "*"), date);
  if (!rule) return new Decimal(0);
  return D(txn.amount).mul(D(rule.percent)).div(100).plus(D(rule.fixed));
}
