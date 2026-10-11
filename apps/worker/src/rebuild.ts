import { D, Decimal, toDb } from "@ecom/core/money";
import { allocate, type AllocationMethod } from "@ecom/core/allocation";
import { chargeDates, type BillingCycle } from "@ecom/core/recurrence";
import { addDays } from "@ecom/core/dates";
import type { FxTable } from "@ecom/core/fx";
import {
  dailyStoreMetrics,
  excludedSet,
  getDb,
  loadFx,
  sql,
  stores as storesTable,
  type Db,
} from "@ecom/db";
import {
  MONEY_COMPONENTS,
  computeStoreDay,
  convertBag,
  handlingFee,
  orderSales,
  paymentFee,
  resolveUnitCost,
  shippingCost,
  type HandlingRule,
  type NOrder,
  type NRefund,
  type PaymentFeeRule,
  type ShippingRule,
} from "@ecom/metrics";
import { log } from "./log";

type Store = typeof storesTable.$inferSelect;

const groupBy = <T, K>(rows: T[], key: (r: T) => K) => {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
};

/** Takes the dirty set and rebuilds derived metrics, store by store, in batches. */
export async function rebuildDirty(db: Db = getDb(), maxDays = 5000) {
  const res = await db.execute<{ store_id: number; date: string }>(sql`
    delete from dirty_store_days where (store_id, date) in (
      select store_id, date from dirty_store_days order by date limit ${maxDays}
    ) returning store_id, date::text as date`);
  if (!res.rows.length) return 0;
  const fx = await loadFx(db);
  const allStores = await db.select().from(storesTable);
  const byStore = groupBy(res.rows, (r) => Number(r.store_id));
  let n = 0;
  for (const [storeId, rows] of byStore) {
    const store = allStores.find((s) => s.id === storeId);
    if (!store) continue;
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    try {
      n += await rebuildStoreDays(db, store, dates, fx, allStores);
    } catch (e) {
      // put them back so the next run retries
      await db.execute(sql`insert into dirty_store_days (store_id, date) select ${storeId}, unnest(${sql.param(dates)}::date[]) on conflict do nothing`);
      throw e;
    }
  }
  return n;
}

interface ExpenseCharge {
  date: string;
  amount: Decimal;
  currency: string;
  scope: string;
  storeId: number | null;
  regionId: number | null;
  allocation: AllocationMethod;
  percents: Record<string, number> | null;
  countsAsAdSpend: boolean;
}

/** Every expense charge (subscription occurrence or one-off) dated within [from, to]. */
export async function expenseCharges(db: Db, from: string, to: string): Promise<ExpenseCharge[]> {
  const out: ExpenseCharge[] = [];
  const subs = await db.execute<any>(sql`select * from subscriptions where status <> 'cancelled' or end_date is not null`);
  const occ = await db.execute<any>(sql`select subscription_id, charge_date::text, coalesce(actual_amount, expected_amount)::text amount, currency from subscription_occurrences where charge_date between ${from} and ${to}`);
  const occBy = new Map<string, any>(occ.rows.map((o: any) => [`${o.subscription_id}:${o.charge_date}`, o]));
  for (const s of subs.rows) {
    const dates = chargeDates(
      { cycle: s.cycle as BillingCycle, everyNMonths: s.every_n_months, anchorDate: s.anchor_date, startDate: s.start_date, endDate: s.status === "cancelled" ? (s.end_date ?? s.updated_at?.toISOString?.().slice(0, 10)) : s.end_date },
      from,
      to,
    );
    for (const d of dates) {
      if (s.status === "trial") continue; // trials cost nothing until converted
      const o = occBy.get(`${s.id}:${d}`);
      out.push({
        date: d,
        amount: D(o ? o.amount : s.amount),
        currency: o ? o.currency : s.currency,
        scope: s.scope,
        storeId: s.store_id,
        regionId: s.region_id,
        allocation: s.allocation,
        percents: s.allocation_percents,
        countsAsAdSpend: s.counts_as_ad_spend,
      });
    }
  }
  const one = await db.execute<any>(sql`select * from expenses where date between ${from} and ${to}`);
  for (const e of one.rows) {
    out.push({
      date: e.date,
      amount: D(e.amount),
      currency: e.currency,
      scope: e.scope,
      storeId: e.store_id,
      regionId: e.region_id,
      allocation: e.allocation,
      percents: e.allocation_percents,
      countsAsAdSpend: e.counts_as_ad_spend,
    });
  }
  return out;
}

/** Stores a charge is spread across. Shared = every active store. */
export function chargeStores(c: Pick<ExpenseCharge, "scope" | "storeId" | "regionId">, allStores: Pick<Store, "id" | "regionId" | "active">[]): number[] {
  const active = allStores.filter((s) => s.active);
  if (c.scope === "store" && c.storeId) return [c.storeId];
  if (c.scope === "region" && c.regionId) return active.filter((s) => s.regionId === c.regionId).map((s) => s.id);
  return active.map((s) => s.id);
}

/** Store revenue (USD) over the 30 days before a date, for revenue-share allocation. */
async function revenueShare(db: Db, date: string) {
  const res = await db.execute<{ store_id: number; rev: string }>(sql`
    select store_id, coalesce(sum(order_revenue_usd),0)::text rev from orders
    where not test and local_date between ${addDays(date, -30)} and ${addDays(date, -1)} group by store_id`);
  return Object.fromEntries(res.rows.map((r) => [Number(r.store_id), r.rev]));
}

export async function rebuildStoreDays(db: Db, store: Store, dates: string[], fx: FxTable, allStores: Store[]) {
  if (!dates.length) return 0;
  const ccy = store.currency;
  const toStore = (amount: Decimal | string, from: string, date: string) => fx.convert(amount, from, ccy, date);

  // ---------- load everything for these dates in a few queries ----------
  const ordersRes = await db.execute<any>(sql`
    select o.id, o.shopify_id, o.name, o.local_date::text local_date, o.test, o.taxes_included, o.customer_id, o.is_first_order,
      o.shipping_amount, o.shipping_tax, o.total_tax, o.shipping_country, o.requires_shipping, o.total_weight_grams
    from orders o where o.store_id = ${store.id} and o.local_date = any(${sql.param(dates)}::date[])`);
  const orderIds = ordersRes.rows.map((o) => Number(o.id));
  const linesRes = orderIds.length
    ? await db.execute<any>(sql`select l.id, l.order_id, l.shopify_id, l.variant_shopify_id, l.product_shopify_id, l.sku, l.title, l.quantity, l.unit_price, l.discount, l.tax, l.gross_ex, l.discount_ex, l.requires_shipping, l.weight_grams
        from order_lines l where l.order_id = any(${sql.param(orderIds)}::bigint[])`)
    : { rows: [] as any[] };
  const txnRes = orderIds.length
    ? await db.execute<any>(sql`select t.order_id, t.shopify_id, t.kind, t.status, t.gateway, t.amount, t.currency, t.test, pbt.fee actual_fee
        from transactions t
        left join payments_balance_txns pbt on pbt.store_id = t.store_id and pbt.source_order_transaction_id = regexp_replace(t.shopify_id, '^.*/', '')
        where t.order_id = any(${sql.param(orderIds)}::bigint[]) and t.status = 'SUCCESS' and t.kind in ('SALE','CAPTURE')`)
    : { rows: [] as any[] };
  // Orders with Shopify Payments fees recorded per order but not matched to a transaction
  const feeByOrder = await db.execute<any>(sql`select order_shopify_id, sum(fee)::text fee from payments_balance_txns
    where store_id = ${store.id} and type = 'CHARGE' and not test and order_shopify_id is not null group by order_shopify_id`);
  const orderFee = new Map<string, string>(feeByOrder.rows.map((r: any) => [r.order_shopify_id, r.fee]));

  const refundsRes = await db.execute<any>(sql`
    select r.id, r.order_id, r.local_date::text local_date, r.total_refunded, r.shipping_amount, r.shipping_tax, r.other_amount, r.return_fees, o.taxes_included, o.test
    from refunds r join orders o on o.id = r.order_id where r.store_id = ${store.id} and r.local_date = any(${sql.param(dates)}::date[])`);
  const refundIds = refundsRes.rows.map((r) => Number(r.id));
  const refundLinesRes = refundIds.length
    ? await db.execute<any>(sql`select rl.refund_id, rl.order_line_shopify_id, rl.quantity, rl.subtotal, rl.tax, rl.restocked, ol.unit_cost
        from refund_lines rl left join order_lines ol on ol.store_id = rl.store_id and ol.shopify_id = rl.order_line_shopify_id
        where rl.refund_id = any(${sql.param(refundIds)}::bigint[])`)
    : { rows: [] as any[] };

  const fulfilledRes = await db.execute<any>(sql`select fulfilled_local_date::text d, count(*)::int n from orders
    where store_id = ${store.id} and not test and fulfilled_local_date = any(${sql.param(dates)}::date[]) group by 1`);
  const sessionsRes = await db.execute<any>(sql`select date::text d, sessions, added_to_cart, reached_checkout, completed_checkout from sessions_daily
    where store_id = ${store.id} and date = any(${sql.param(dates)}::date[])`);
  const adsRes = await db.execute<any>(sql`
    select m.date::text d, a.currency, a.platform, sum(m.spend_native)::text spend, sum(m.purchase_value_native)::text pv,
      sum(m.purchases)::text purchases, sum(m.impressions)::text impressions, sum(m.link_clicks)::text link_clicks, sum(m.clicks)::text clicks
    from daily_ad_metrics m join ad_accounts a on a.id = m.ad_account_id
    where m.store_id = ${store.id} and m.date = any(${sql.param(dates)}::date[]) group by 1,2,3`);

  // ---------- cost rules ----------
  const variantRows = await db.execute<any>(sql`select shopify_id, sku, shopify_cost, weight_grams from variants where store_id = ${store.id}`);
  const variantBy = new Map<string, any>(variantRows.rows.map((v: any) => [v.shopify_id, v]));
  const typedRows = await db.execute<any>(sql`select sku, variant_shopify_id, cost, currency, effective_from::text effective_from from variant_costs where store_id = ${store.id}`);
  const typedBySku = groupBy(typedRows.rows.filter((r: any) => r.sku), (r: any) => String(r.sku).toLowerCase());
  const typedByVariant = groupBy(typedRows.rows.filter((r: any) => r.variant_shopify_id), (r: any) => r.variant_shopify_id as string);
  const shipRules: ShippingRule[] = (await db.execute<any>(sql`select * from shipping_rules where store_id = ${store.id}`)).rows.map((r: any) => ({
    effectiveFrom: r.effective_from,
    mode: r.mode,
    flatAmount: r.flat_amount,
    table: r.table ?? undefined,
    _ccy: r.currency,
  })) as any;
  const handlingRules = (await db.execute<any>(sql`select * from handling_rules where store_id = ${store.id}`)).rows.map((r: any) => ({
    effectiveFrom: r.effective_from,
    perOrder: r.per_order,
    perItem: r.per_item,
    _ccy: r.currency,
  })) as (HandlingRule & { _ccy: string })[];
  const feeRules = (await db.execute<any>(sql`select * from payment_fee_rules where store_id = ${store.id}`)).rows.map((r: any) => ({
    effectiveFrom: r.effective_from,
    gateway: r.gateway,
    percent: r.percent,
    fixed: r.fixed,
    _ccy: r.currency,
  })) as (PaymentFeeRule & { _ccy: string })[];
  const actualShip = await db.execute<any>(sql`select order_name, cost, currency from order_shipping_costs where store_id = ${store.id}`);
  const actualShipBy = new Map<string, any>(actualShip.rows.map((r: any) => [r.order_name, r]));
  const fallbackPct = store.cogsFallbackPercent ? Number(store.cogsFallbackPercent) : null;

  // ---------- expenses for these dates ----------
  const charges = await expenseCharges(db, dates[0], dates[dates.length - 1]);
  const dateSet = new Set(dates);
  const expenseBy = new Map<string, { operating: Decimal; adSpend: Decimal }>();
  for (const c of charges) {
    if (!dateSet.has(c.date)) continue;
    const ids = chargeStores(c, allStores);
    if (!ids.includes(store.id)) continue;
    const rev = c.allocation === "revenue" ? await revenueShare(db, c.date) : undefined;
    const share = allocate({ amount: c.amount, storeIds: ids, method: c.allocation, fixedPercents: c.percents ?? undefined, revenueByStore: rev }).get(store.id) ?? new Decimal(0);
    const inStore = toStore(share, c.currency, c.date);
    const e = expenseBy.get(c.date) ?? { operating: new Decimal(0), adSpend: new Decimal(0) };
    if (c.countsAsAdSpend) e.adSpend = e.adSpend.plus(inStore);
    else e.operating = e.operating.plus(inStore);
    expenseBy.set(c.date, e);
  }

  // ---------- per order: resolve unit costs and operational costs ----------
  const linesByOrder = groupBy(linesRes.rows, (l: any) => Number(l.order_id));
  const txnsByOrder = groupBy(txnRes.rows, (t: any) => Number(t.order_id));
  const lineCostUpdates: { id: number; cost: string | null; source: string }[] = [];
  const ordersByDate = new Map<string, NOrder[]>();
  const orderCosts: Record<string, { shippingCost: Decimal; handlingFee: Decimal; paymentFee: Decimal }> = {};
  const fxUpdates: { id: number; usd: string; eur: string; rev: string; revUsd: string; revEur: string }[] = [];

  for (const o of ordersRes.rows) {
    const date = o.local_date as string;
    const lines = linesByOrder.get(Number(o.id)) ?? [];
    let items = 0;
    let weight = 0;
    const nLines = lines.map((l: any) => {
      const v = l.variant_shopify_id ? variantBy.get(l.variant_shopify_id) : undefined;
      const typed = [...(l.variant_shopify_id ? typedByVariant.get(l.variant_shopify_id) ?? [] : []), ...(l.sku ? typedBySku.get(String(l.sku).toLowerCase()) ?? [] : [])].map((t: any) => ({
        effectiveFrom: t.effective_from,
        cost: toStore(t.cost, t.currency, date),
      }));
      const unitPriceEx = l.quantity ? D(l.gross_ex).div(l.quantity) : D(0);
      const resolved = resolveUnitCost(date, { typed, shopifyCost: v?.shopify_cost ?? null, fallbackPercent: fallbackPct, unitPriceExTax: unitPriceEx });
      lineCostUpdates.push({ id: Number(l.id), cost: resolved.cost ? toDb(resolved.cost) : null, source: resolved.source });
      if (l.requires_shipping) {
        items += l.quantity;
        weight += (v?.weight_grams ?? l.weight_grams ?? 0) * l.quantity;
      }
      return {
        id: l.shopify_id,
        variantId: l.variant_shopify_id,
        productId: l.product_shopify_id,
        sku: l.sku,
        title: l.title,
        quantity: l.quantity,
        unitPrice: l.unit_price,
        discount: l.discount,
        tax: l.tax,
        unitCost: resolved.cost,
      };
    });
    const n: NOrder = {
      id: o.shopify_id,
      localDate: date,
      test: o.test,
      taxesIncluded: o.taxes_included,
      customerId: o.customer_id,
      isFirstOrder: o.is_first_order,
      lines: nLines,
      shippingAmount: o.shipping_amount,
      shippingTax: o.shipping_tax,
      totalTax: o.total_tax,
    };
    const list = ordersByDate.get(date) ?? [];
    list.push(n);
    ordersByDate.set(date, list);

    // order revenue in native/USD/EUR, kept on the order for product & ad-level joins
    const sales = orderSales(n);
    fxUpdates.push({
      id: Number(o.id),
      usd: fx.convert(1, ccy, "USD", date).toFixed(10),
      eur: fx.convert(1, ccy, "EUR", date).toFixed(10),
      rev: toDb(sales.revenue),
      revUsd: toDb(fx.convert(sales.revenue, ccy, "USD", date)),
      revEur: toDb(fx.convert(sales.revenue, ccy, "EUR", date)),
    });

    if (o.test) continue;
    const act = actualShipBy.get(o.name);
    const shipRule = shipRules.map((r: any) => ({ ...r, flatAmount: toStore(r.flatAmount, r._ccy, date), table: r.table?.map((t: any) => ({ ...t, amount: toStore(t.amount, r._ccy, date) })) }));
    const ship = shippingCost(shipRule, date, {
      country: o.shipping_country,
      weightGrams: weight || o.total_weight_grams || 0,
      items,
      actual: act ? toStore(act.cost, act.currency, date) : null,
      requiresShipping: o.requires_shipping,
    });
    const handling = handlingFee(handlingRules.map((r) => ({ ...r, perOrder: toStore(D(r.perOrder), r._ccy, date), perItem: toStore(D(r.perItem), r._ccy, date) })), date, items);
    let fee = new Decimal(0);
    const txns = txnsByOrder.get(Number(o.id)) ?? [];
    const perOrderActual = orderFee.get(o.shopify_id);
    const anyMatched = txns.some((t: any) => t.actual_fee !== null);
    if (perOrderActual && !anyMatched) fee = D(perOrderActual);
    else {
      const rules = feeRules.map((r) => ({ ...r, fixed: toStore(D(r.fixed), r._ccy, date) }));
      for (const t of txns) {
        if (t.test) continue;
        fee = fee.plus(paymentFee(rules, date, { gateway: t.gateway, amount: toStore(t.amount, t.currency, date), actualFee: t.actual_fee }));
      }
    }
    orderCosts[o.shopify_id] = { shippingCost: ship, handlingFee: handling, paymentFee: fee };
  }

  // ---------- refunds ----------
  const rlBy = groupBy(refundLinesRes.rows, (r: any) => Number(r.refund_id));
  const refundsByDate = new Map<string, NRefund[]>();
  const refundFx: { id: number; usd: string; eur: string }[] = [];
  for (const r of refundsRes.rows) {
    refundFx.push({ id: Number(r.id), usd: toDb(fx.convert(r.total_refunded, ccy, "USD", r.local_date)), eur: toDb(fx.convert(r.total_refunded, ccy, "EUR", r.local_date)) });
    if (r.test) continue;
    const list = refundsByDate.get(r.local_date) ?? [];
    list.push({
      id: String(r.id),
      orderId: String(r.order_id),
      localDate: r.local_date,
      taxesIncluded: r.taxes_included,
      lines: (rlBy.get(Number(r.id)) ?? []).map((l: any) => ({
        lineId: l.order_line_shopify_id,
        quantity: l.quantity,
        subtotal: l.subtotal,
        tax: l.tax,
        restocked: l.restocked,
        unitCost: l.unit_cost,
      })),
      // refund shipping subtotal excludes tax; NRefund expects tax-inclusive when prices include tax
      shippingAmount: r.taxes_included ? D(r.shipping_amount).plus(r.shipping_tax) : r.shipping_amount,
      shippingTax: r.shipping_tax,
      otherAmount: r.other_amount,
      returnFees: r.return_fees,
    });
    refundsByDate.set(r.local_date, list);
  }

  // ---------- compute and write ----------
  const fulfilledBy = new Map<string, number>(fulfilledRes.rows.map((r: any) => [r.d, r.n]));
  const sessionsBy = new Map<string, any>(sessionsRes.rows.map((r: any) => [r.d, r]));
  const adsBy = groupBy(adsRes.rows, (r: any) => r.d as string);
  const rows: (typeof dailyStoreMetrics.$inferInsert)[] = [];

  for (const date of dates) {
    const ads: Record<string, Decimal> = {};
    for (const a of adsBy.get(date) ?? []) {
      const key = a.platform === "google" ? "ad_spend_google" : a.platform === "tiktok" ? "ad_spend_tiktok" : "ad_spend_meta";
      ads[key] = (ads[key] ?? new Decimal(0)).plus(toStore(a.spend, a.currency, date));
      if (a.platform === "meta") {
        ads.meta_purchase_value = (ads.meta_purchase_value ?? new Decimal(0)).plus(toStore(a.pv, a.currency, date));
        ads.meta_purchases = (ads.meta_purchases ?? new Decimal(0)).plus(a.purchases);
      }
      ads.impressions = (ads.impressions ?? new Decimal(0)).plus(a.impressions);
      ads.link_clicks = (ads.link_clicks ?? new Decimal(0)).plus(a.link_clicks);
      ads.clicks = (ads.clicks ?? new Decimal(0)).plus(a.clicks);
    }
    const s = sessionsBy.get(date);
    const bag = computeStoreDay({
      date,
      orders: ordersByDate.get(date) ?? [],
      orderCosts,
      refunds: refundsByDate.get(date) ?? [],
      ordersFulfilled: fulfilledBy.get(date) ?? 0,
      sessions: s ? { sessions: s.sessions, addedToCart: s.added_to_cart, reachedCheckout: s.reached_checkout, completedCheckout: s.completed_checkout } : null,
      ads,
      expenses: expenseBy.get(date),
    });
    for (const target of ["USD", "EUR"] as const) {
      const factor = fx.convert(1, ccy, target, date);
      const conv = convertBag(bag, factor, MONEY_COMPONENTS);
      const row: Record<string, unknown> = { storeId: store.id, date, currency: target, rebuiltAt: new Date() };
      for (const [k, v] of Object.entries(conv)) row[k] = (v as Decimal).toDecimalPlaces(6).toFixed(6);
      rows.push(row as typeof dailyStoreMetrics.$inferInsert);
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx
        .insert(dailyStoreMetrics)
        .values(chunk)
        .onConflictDoUpdate({ target: [dailyStoreMetrics.storeId, dailyStoreMetrics.date, dailyStoreMetrics.currency], set: excludedSet(dailyStoreMetrics, ["storeId", "date", "currency"]) });
    }
    // unit-cost snapshot on each line, and FX/revenue on each order
    for (let i = 0; i < lineCostUpdates.length; i += 1000) {
      const chunk = lineCostUpdates.slice(i, i + 1000);
      await tx.execute(sql`update order_lines l set unit_cost = v.cost::numeric, cost_source = v.source
        from (select unnest(${sql.param(chunk.map((c) => c.id))}::bigint[]) id, unnest(${sql.param(chunk.map((c) => c.cost))}::text[]) cost, unnest(${sql.param(chunk.map((c) => c.source))}::text[]) source) v
        where l.id = v.id`);
    }
    for (let i = 0; i < fxUpdates.length; i += 1000) {
      const c = fxUpdates.slice(i, i + 1000);
      await tx.execute(sql`update orders o set fx_to_usd = v.usd::numeric, fx_to_eur = v.eur::numeric, order_revenue = v.rev::numeric, order_revenue_usd = v.ru::numeric, order_revenue_eur = v.re::numeric
        from (select unnest(${sql.param(c.map((x) => x.id))}::bigint[]) id, unnest(${sql.param(c.map((x) => x.usd))}::text[]) usd, unnest(${sql.param(c.map((x) => x.eur))}::text[]) eur,
                     unnest(${sql.param(c.map((x) => x.rev))}::text[]) rev, unnest(${sql.param(c.map((x) => x.revUsd))}::text[]) ru, unnest(${sql.param(c.map((x) => x.revEur))}::text[]) re) v
        where o.id = v.id`);
    }
    // refunds in USD/EUR as well
    if (refundFx.length) {
      await tx.execute(sql`update refunds r set total_refunded_usd = v.usd::numeric, total_refunded_eur = v.eur::numeric
        from (select unnest(${sql.param(refundFx.map((x) => x.id))}::bigint[]) id, unnest(${sql.param(refundFx.map((x) => x.usd))}::text[]) usd, unnest(${sql.param(refundFx.map((x) => x.eur))}::text[]) eur) v
        where r.id = v.id`);
    }
  });
  log.info("rebuilt store-days", { store: store.name, days: dates.length });
  return dates.length;
}
