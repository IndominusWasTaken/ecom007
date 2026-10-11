import { D, Decimal, type DecimalLike } from "@ecom/core/money";

/**
 * Normalised order shapes used by the metric engine. All money is in the store's
 * currency (Shopify "shopMoney"). Dates are store-local ISO dates.
 */
export interface NLine {
  id: string;
  variantId: string | null;
  productId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  unitPrice: DecimalLike; // original unit price (tax-inclusive when the order is)
  discount: DecimalLike; // all discounts allocated to the line
  tax: DecimalLike; // tax on the line
  /** Unit cost in store currency resolved for the order date, or null when unknown. */
  unitCost: DecimalLike | null;
}

export interface NOrder {
  id: string;
  localDate: string;
  test: boolean;
  taxesIncluded: boolean;
  customerId: string | null;
  /** Is this the customer's first order in this store? */
  isFirstOrder: boolean;
  lines: NLine[];
  shippingAmount: DecimalLike; // after shipping discounts; tax-inclusive when the order is
  shippingTax: DecimalLike;
  totalTax: DecimalLike;
  fulfilledLocalDate?: string | null;
}

export interface NRefundLine {
  lineId: string;
  quantity: number;
  subtotal: DecimalLike; // refunded amount for the line after discounts (tax-inclusive when the order is)
  tax: DecimalLike;
  restocked: boolean;
  unitCost: DecimalLike | null;
}

export interface NRefund {
  id: string;
  orderId: string;
  localDate: string;
  taxesIncluded: boolean;
  lines: NRefundLine[];
  shippingAmount: DecimalLike; // refunded shipping (tax-inclusive when the order is)
  shippingTax: DecimalLike;
  /** Refunded money not tied to a line or shipping (goodwill refunds, adjustments). Positive number. */
  otherAmount?: DecimalLike;
  returnFees?: DecimalLike;
}

export interface OrderSales {
  gross: Decimal;
  discounts: Decimal;
  shipping: Decimal; // ex tax
  taxes: Decimal;
  revenue: Decimal; // gross − discounts + shipping + taxes
  units: number;
  cogs: Decimal;
  missingCostUnits: number;
  missingCostRevenue: Decimal;
}

/**
 * Gross and discounts exclude tax, as in Shopify's sales report. For tax-inclusive
 * prices the tax share is removed proportionally from price and discount, so
 * gross − discounts equals the line's net amount excluding tax.
 */
export function lineSales(line: NLine, taxesIncluded: boolean) {
  const incl = D(line.unitPrice).mul(line.quantity);
  const disc = D(line.discount);
  const tax = D(line.tax);
  if (!taxesIncluded) return { gross: incl, discount: disc, tax };
  const netIncl = incl.minus(disc);
  const factor = netIncl.gt(0) ? netIncl.minus(tax).div(netIncl) : incl.gt(0) ? new Decimal(1) : new Decimal(1);
  return { gross: incl.mul(factor), discount: disc.mul(factor), tax };
}

export function orderSales(o: NOrder): OrderSales {
  let gross = new Decimal(0);
  let discounts = new Decimal(0);
  let units = 0;
  let cogs = new Decimal(0);
  let missingCostUnits = 0;
  let missingCostRevenue = new Decimal(0);
  for (const l of o.lines) {
    const s = lineSales(l, o.taxesIncluded);
    gross = gross.plus(s.gross);
    discounts = discounts.plus(s.discount);
    units += l.quantity;
    if (l.unitCost === null || l.unitCost === undefined) {
      missingCostUnits += l.quantity;
      missingCostRevenue = missingCostRevenue.plus(s.gross.minus(s.discount));
    } else {
      cogs = cogs.plus(D(l.unitCost).mul(l.quantity));
    }
  }
  const shipping = o.taxesIncluded ? D(o.shippingAmount).minus(D(o.shippingTax)) : D(o.shippingAmount);
  const taxes = D(o.totalTax);
  const revenue = gross.minus(discounts).plus(shipping).plus(taxes);
  return { gross, discounts, shipping, taxes, revenue, units, cogs, missingCostUnits, missingCostRevenue };
}

export interface RefundEffect {
  salesReversals: Decimal;
  shippingRefunded: Decimal;
  taxRefunded: Decimal;
  returnFees: Decimal;
  restockedCogs: Decimal;
}

export function refundEffect(r: NRefund): RefundEffect {
  let reversals = new Decimal(0);
  let tax = new Decimal(0);
  let restocked = new Decimal(0);
  for (const l of r.lines) {
    const sub = D(l.subtotal);
    const t = D(l.tax);
    reversals = reversals.plus(r.taxesIncluded ? sub.minus(t) : sub);
    tax = tax.plus(t);
    if (l.restocked && l.unitCost !== null && l.unitCost !== undefined) {
      restocked = restocked.plus(D(l.unitCost).mul(l.quantity));
    }
  }
  reversals = reversals.plus(D(r.otherAmount));
  const shipTax = D(r.shippingTax);
  const shipping = r.taxesIncluded ? D(r.shippingAmount).minus(shipTax) : D(r.shippingAmount);
  tax = tax.plus(shipTax);
  return { salesReversals: reversals, shippingRefunded: shipping, taxRefunded: tax, returnFees: D(r.returnFees), restockedCogs: restocked };
}
