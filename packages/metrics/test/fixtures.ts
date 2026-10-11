import type { NOrder, NRefund } from "../src/orders";

/**
 * Fixture orders. US store prices exclude tax (USD); the Bulgarian store prices include
 * 20% VAT (EUR). Customer details are synthetic ids only.
 */
export const usOrders: NOrder[] = [
  // 1. Plain order, new customer, two lines, sales tax 8%
  {
    id: "us-1001",
    localDate: "2026-09-01",
    test: false,
    taxesIncluded: false,
    customerId: "c1",
    isFirstOrder: true,
    lines: [
      { id: "l1", variantId: "v1", productId: "p1", sku: "SKU-A", title: "A", quantity: 2, unitPrice: "25.00", discount: "0", tax: "4.00", unitCost: "8.00" },
      { id: "l2", variantId: "v2", productId: "p2", sku: "SKU-B", title: "B", quantity: 1, unitPrice: "40.00", discount: "0", tax: "3.20", unitCost: "12.00" },
    ],
    shippingAmount: "5.00",
    shippingTax: "0",
    totalTax: "7.20",
  },
  // 2. Discounted order (10 off line), returning customer
  {
    id: "us-1002",
    localDate: "2026-09-01",
    test: false,
    taxesIncluded: false,
    customerId: "c2",
    isFirstOrder: false,
    lines: [{ id: "l3", variantId: "v1", productId: "p1", sku: "SKU-A", title: "A", quantity: 4, unitPrice: "25.00", discount: "10.00", tax: "7.20", unitCost: "8.00" }],
    shippingAmount: "0",
    shippingTax: "0",
    totalTax: "7.20",
  },
  // 3. Zero-value order (100% discount, free shipping), new customer
  {
    id: "us-1003",
    localDate: "2026-09-01",
    test: false,
    taxesIncluded: false,
    customerId: "c3",
    isFirstOrder: true,
    lines: [{ id: "l4", variantId: "v2", productId: "p2", sku: "SKU-B", title: "B", quantity: 1, unitPrice: "40.00", discount: "40.00", tax: "0", unitCost: "12.00" }],
    shippingAmount: "0",
    shippingTax: "0",
    totalTax: "0",
  },
  // 4. Test order: must be ignored
  {
    id: "us-1004",
    localDate: "2026-09-01",
    test: true,
    taxesIncluded: false,
    customerId: "c9",
    isFirstOrder: true,
    lines: [{ id: "l5", variantId: "v1", productId: "p1", sku: "SKU-A", title: "A", quantity: 1, unitPrice: "25.00", discount: "0", tax: "0", unitCost: "8.00" }],
    shippingAmount: "0",
    shippingTax: "0",
    totalTax: "0",
  },
];

/** Full refund of order us-1002 two days later, items restocked. */
export const usFullRefund: NRefund = {
  id: "r1",
  orderId: "us-1002",
  localDate: "2026-09-03",
  taxesIncluded: false,
  lines: [{ lineId: "l3", quantity: 4, subtotal: "90.00", tax: "7.20", restocked: true, unitCost: "8.00" }],
  shippingAmount: "0",
  shippingTax: "0",
};

/** Partial refund on us-1001: one unit of SKU-A, not restocked, plus the shipping. */
export const usPartialRefund: NRefund = {
  id: "r2",
  orderId: "us-1001",
  localDate: "2026-09-03",
  taxesIncluded: false,
  lines: [{ lineId: "l1", quantity: 1, subtotal: "25.00", tax: "2.00", restocked: false, unitCost: "8.00" }],
  shippingAmount: "5.00",
  shippingTax: "0",
};

/** Bulgarian store: tax-inclusive prices (20% VAT), EUR. */
export const bgOrders: NOrder[] = [
  {
    id: "bg-1",
    localDate: "2026-09-01",
    test: false,
    taxesIncluded: true,
    customerId: "b1",
    isFirstOrder: true,
    // 2 × €30 incl VAT = €60 incl; VAT = 60/1.2*0.2 = €10
    lines: [{ id: "bl1", variantId: "bv1", productId: "bp1", sku: "BG-1", title: "Serum", quantity: 2, unitPrice: "30.00", discount: "0", tax: "10.00", unitCost: "9.00" }],
    // shipping €6 incl VAT = €1 VAT
    shippingAmount: "6.00",
    shippingTax: "1.00",
    totalTax: "11.00",
  },
  {
    id: "bg-2",
    localDate: "2026-09-01",
    test: false,
    taxesIncluded: true,
    customerId: "b2",
    isFirstOrder: true,
    // €24 incl with €6 discount → €18 net incl, VAT €3
    lines: [{ id: "bl2", variantId: "bv1", productId: "bp1", sku: "BG-1", title: "Serum", quantity: 1, unitPrice: "24.00", discount: "6.00", tax: "3.00", unitCost: null }],
    shippingAmount: "0",
    shippingTax: "0",
    totalTax: "3.00",
  },
];

export const bgPartialRefund: NRefund = {
  id: "br1",
  orderId: "bg-1",
  localDate: "2026-09-01",
  taxesIncluded: true,
  lines: [{ lineId: "bl1", quantity: 1, subtotal: "30.00", tax: "5.00", restocked: true, unitCost: "9.00" }],
  shippingAmount: "0",
  shippingTax: "0",
};
