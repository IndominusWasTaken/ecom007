import { D, Decimal, type DecimalLike } from "./money";

/**
 * How a cost is split across stores.
 *  - equal: split evenly across the stores in scope
 *  - fixed: explicit percentages per store (normalised to 100%)
 *  - revenue: proportional to each store's revenue (falls back to equal when all revenue is zero)
 */
export type AllocationMethod = "equal" | "fixed" | "revenue";

export interface AllocationInput {
  amount: DecimalLike;
  storeIds: number[];
  method: AllocationMethod;
  fixedPercents?: Record<number, number>;
  revenueByStore?: Record<number, DecimalLike>;
}

/**
 * Returns the share per store. Shares always sum exactly to `amount`:
 * rounding remainders (to 6 dp) go to the last store.
 */
export function allocate(input: AllocationInput): Map<number, Decimal> {
  const out = new Map<number, Decimal>();
  const ids = [...input.storeIds];
  if (ids.length === 0) return out;
  const amount = D(input.amount);

  let weights: Decimal[];
  if (input.method === "fixed" && input.fixedPercents) {
    weights = ids.map((id) => D(input.fixedPercents![id] ?? 0));
  } else if (input.method === "revenue" && input.revenueByStore) {
    weights = ids.map((id) => D(input.revenueByStore![id] ?? 0).abs());
  } else {
    weights = ids.map(() => new Decimal(1));
  }
  let total = weights.reduce((a, b) => a.plus(b), new Decimal(0));
  if (total.isZero()) {
    weights = ids.map(() => new Decimal(1));
    total = new Decimal(ids.length);
  }
  let assigned = new Decimal(0);
  ids.forEach((id, i) => {
    if (i === ids.length - 1) {
      out.set(id, amount.minus(assigned));
    } else {
      const share = amount.mul(weights[i]).div(total).toDecimalPlaces(6);
      assigned = assigned.plus(share);
      out.set(id, share);
    }
  });
  return out;
}
