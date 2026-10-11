import { sleep } from "../http";
import { ConnectorError, type Connector, type Health } from "../types";
import { ShopifyClient } from "./client";
import {
  BALANCE_TXNS_QUERY,
  BULK_RUN_MUTATION,
  BULK_STATUS_QUERY,
  ORDER_DETAIL_QUERY,
  ORDERS_COUNT_PROBE,
  ORDERS_QUERY,
  SHOP_QUERY,
  SHOPIFYQL_QUERY,
  VARIANTS_QUERY,
  bulkOrdersQuery,
} from "./queries";
import { assembleBulk, needsDetail, normalizeOrder, orderChildKey, shopifyqlRows, weightToGrams, type OrderRecord } from "./normalize";

export * from "./client";
export * from "./normalize";
export * as shopifyQueries from "./queries";

export interface VariantRecord {
  shopifyId: string;
  productShopifyId: string;
  productTitle: string;
  productStatus: string | null;
  productType: string | null;
  vendor: string | null;
  imageUrl: string | null;
  productUpdatedAt: string | null;
  sku: string | null;
  title: string | null;
  price: string | null;
  shopifyCost: string | null;
  shopifyCostCurrency: string | null;
  weightGrams: number | null;
  inventoryQuantity: number | null;
  raw: unknown;
}

export interface BalanceTxnRecord {
  shopifyId: string;
  type: string;
  test: boolean;
  transactionDate: string;
  amount: string;
  fee: string;
  net: string;
  currency: string;
  orderShopifyId: string | null;
  sourceOrderTransactionId: string | null;
  raw: unknown;
}

export interface SessionsRow {
  date: string;
  sessions: number;
  addedToCart: number;
  reachedCheckout: number;
  completedCheckout: number;
  raw: unknown;
}

export interface ShopifySink {
  orders(records: OrderRecord[]): Promise<number>;
}

export interface ShopifyCtx {
  client: ShopifyClient;
}

const iso = (d: Date) => d.toISOString();

/** Fill in refunds and truncated lines for orders that need it. */
async function completeOrders(client: ShopifyClient, records: OrderRecord[]): Promise<OrderRecord[]> {
  const out: OrderRecord[] = [];
  for (const r of records) {
    if (!needsDetail(r)) {
      out.push(r.refunds === null ? { ...r, refunds: [] } : r);
      continue;
    }
    const data = await client.graphql<{ order: any }>(ORDER_DETAIL_QUERY, { id: r.shopifyId });
    out.push(data.order ? normalizeOrder(data.order) : { ...r, refunds: [] });
  }
  return out;
}

/** Orders updated since `cursor` (ISO). Overlaps by 5 minutes; upserts make that safe. */
export async function syncOrders(client: ShopifyClient, sink: ShopifySink, cursor: string | null, sinceIfNone: string) {
  const since = cursor ? new Date(new Date(cursor).getTime() - 5 * 60_000) : new Date(sinceIfNone);
  const startedAt = new Date();
  let rows = 0;
  let maxUpdated = cursor;
  const q = `updated_at:>='${iso(since)}'`;
  for await (const nodes of client.paginate<any>(ORDERS_QUERY, { first: 10, query: q }, (d) => d.orders)) {
    const records = await completeOrders(client, nodes.map(normalizeOrder));
    rows += await sink.orders(records);
    for (const r of records) if (!maxUpdated || r.updatedAt > maxUpdated) maxUpdated = r.updatedAt;
  }
  // Never move the cursor past the moment we started, so nothing updated mid-run is skipped.
  const next = maxUpdated && maxUpdated < iso(startedAt) ? maxUpdated : iso(startedAt);
  return { cursor: next, rows };
}

/**
 * History via a bulk operation. Resumable: the cursor holds the bulk operation id, so a
 * restart picks up the same job instead of starting a new one.
 */
export async function loadOrderHistory(
  client: ShopifyClient,
  sink: ShopifySink,
  opts: { since: string; cursor?: string | null; onProgress?: (m: string) => void },
): Promise<{ cursor: string | null; done: boolean; rows: number }> {
  let opId = opts.cursor && opts.cursor.startsWith("gid://shopify/BulkOperation/") ? opts.cursor : null;
  if (!opId) {
    const res = await client.graphql<any>(BULK_RUN_MUTATION, { query: bulkOrdersQuery(opts.since) });
    const errs = res.bulkOperationRunQuery?.userErrors ?? [];
    if (errs.length) {
      // Another bulk op running, or bulk unavailable: fall back to paginated loading.
      opts.onProgress?.(`Bulk operation refused (${errs.map((e: any) => e.message).join("; ")}); using paginated load`);
      const r = await syncOrders(client, sink, null, opts.since);
      return { cursor: null, done: true, rows: r.rows };
    }
    opId = res.bulkOperationRunQuery.bulkOperation.id as string;
  }
  let url: string | null = null;
  for (let i = 0; i < 720; i++) {
    const s = await client.graphql<any>(BULK_STATUS_QUERY, { id: opId });
    const st = s.node?.status;
    opts.onProgress?.(`Bulk ${st}, ${s.node?.objectCount ?? 0} objects`);
    if (st === "COMPLETED") {
      url = s.node.url ?? s.node.partialDataUrl ?? null;
      break;
    }
    if (st === "FAILED" || st === "CANCELED" || st === "EXPIRED") {
      throw new ConnectorError(`Bulk operation ${st}: ${s.node?.errorCode ?? ""}`, 500, false);
    }
    await sleep(5000);
  }
  if (!url) return { cursor: null, done: true, rows: 0 }; // completed with no data
  const res = await fetch(url);
  const text = await res.text();
  const roots = assembleBulk(text, orderChildKey);
  let rows = 0;
  for (let i = 0; i < roots.length; i += 50) {
    const records = await completeOrders(client, roots.slice(i, i + 50).map(normalizeOrder));
    rows += await sink.orders(records);
    opts.onProgress?.(`Stored ${Math.min(i + 50, roots.length)} / ${roots.length} orders`);
  }
  return { cursor: null, done: true, rows };
}

export async function fetchVariants(client: ShopifyClient, updatedSince: string | null): Promise<VariantRecord[]> {
  const out: VariantRecord[] = [];
  const q = updatedSince ? `updated_at:>='${updatedSince}'` : undefined;
  for await (const nodes of client.paginate<any>(VARIANTS_QUERY, { first: 100, query: q }, (d) => d.productVariants)) {
    for (const v of nodes) {
      out.push({
        shopifyId: v.id,
        productShopifyId: v.product?.id,
        productTitle: v.product?.title ?? "",
        productStatus: v.product?.status ?? null,
        productType: v.product?.productType ?? null,
        vendor: v.product?.vendor ?? null,
        imageUrl: v.product?.featuredMedia?.preview?.image?.url ?? null,
        productUpdatedAt: v.product?.updatedAt ?? null,
        sku: v.sku || null,
        title: v.title ?? null,
        price: v.price ?? null,
        shopifyCost: v.inventoryItem?.unitCost?.amount ?? null,
        shopifyCostCurrency: v.inventoryItem?.unitCost?.currencyCode ?? null,
        weightGrams: weightToGrams(v.inventoryItem?.measurement?.weight),
        inventoryQuantity: v.inventoryQuantity ?? null,
        raw: v,
      });
    }
  }
  return out;
}

export async function fetchBalanceTransactions(client: ShopifyClient, sinceIso: string): Promise<BalanceTxnRecord[]> {
  const out: BalanceTxnRecord[] = [];
  const q = `processed_at:>='${sinceIso.slice(0, 10)}'`;
  for await (const nodes of client.paginate<any>(BALANCE_TXNS_QUERY, { first: 100, query: q }, (d) => d.shopifyPaymentsAccount?.balanceTransactions)) {
    for (const t of nodes) {
      out.push({
        shopifyId: t.id,
        type: t.type,
        test: Boolean(t.test),
        transactionDate: t.transactionDate,
        amount: t.amount?.amount ?? "0",
        // Shopify reports fees as positive amounts on charges
        fee: t.fee?.amount ?? "0",
        net: t.net?.amount ?? "0",
        currency: t.amount?.currencyCode ?? t.fee?.currencyCode,
        orderShopifyId: t.associatedOrder?.id ?? null,
        sourceOrderTransactionId: t.sourceOrderTransactionId ?? null,
        raw: t,
      });
    }
  }
  return out;
}

async function shopifyql(client: ShopifyClient, q: string) {
  const d = await client.graphql<any>(SHOPIFYQL_QUERY, { q });
  const r = d.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new ConnectorError(`ShopifyQL: ${JSON.stringify(r.parseErrors)}`, 400);
  return shopifyqlRows(r?.tableData);
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const dayOf = (row: Record<string, unknown>) => String(row.day ?? row.date ?? "").slice(0, 10);

/** Sessions and the checkout funnel, per day (store time zone). Needs read_reports + level 2 PCD. */
export async function fetchSessions(client: ShopifyClient, from: string, to: string): Promise<SessionsRow[]> {
  const rows = await shopifyql(
    client,
    `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE ${from} UNTIL ${to} ORDER BY day ASC`,
  );
  return rows
    .filter((r) => dayOf(r))
    .map((r) => ({
      date: dayOf(r),
      sessions: num(r.sessions),
      addedToCart: num(r.sessions_with_cart_additions),
      reachedCheckout: num(r.sessions_that_reached_checkout),
      completedCheckout: num(r.sessions_that_completed_checkout),
      raw: r,
    }));
}

/** Shopify's own daily total sales and orders, for reconciliation. */
export async function fetchSalesReport(client: ShopifyClient, from: string, to: string) {
  const rows = await shopifyql(client, `FROM sales SHOW total_sales, orders TIMESERIES day SINCE ${from} UNTIL ${to} ORDER BY day ASC`);
  return rows.filter((r) => dayOf(r)).map((r) => ({ date: dayOf(r), totalSales: String(r.total_sales ?? "0"), orders: num(r.orders), raw: r }));
}

export async function fetchShop(client: ShopifyClient) {
  const d = await client.graphql<any>(SHOP_QUERY);
  return d.shop as { id: string; name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string; taxesIncluded: boolean; plan?: { publicDisplayName?: string } };
}

export async function probeLatestOrder(client: ShopifyClient) {
  const d = await client.graphql<any>(ORDERS_COUNT_PROBE);
  return d.orders?.nodes?.[0] ?? null;
}

export const REQUIRED_SCOPES = ["read_orders", "read_all_orders", "read_products", "read_inventory", "read_customers", "read_reports", "read_shopify_payments", "read_shopify_payments_accounts"];

export const shopifyConnector: Connector<ShopifyCtx, ShopifySink> = {
  platform: "shopify",
  label: "Shopify",
  available: true,
  loadHistory: (ctx, sink, opts) => loadOrderHistory(ctx.client, sink, opts),
  syncSince: (ctx, sink, cursor) => syncOrders(ctx.client, sink, cursor, new Date(Date.now() - 86_400_000).toISOString()),
  async checkHealth(ctx): Promise<Health> {
    try {
      const shop = await fetchShop(ctx.client);
      const scopes = ctx.client.grantedScopes;
      const missing = scopes.length ? REQUIRED_SCOPES.filter((s) => !scopes.includes(s)) : [];
      let sessions = "ok";
      try {
        const today = new Date().toISOString().slice(0, 10);
        await fetchSessions(ctx.client, today, today);
      } catch (e) {
        sessions = `not connected: ${(e as Error).message}`;
      }
      return {
        ok: true,
        message: missing.length ? `Connected to ${shop.name}; missing scopes: ${missing.join(", ")}` : `Connected to ${shop.name}`,
        detail: { shop, scopes, missing, sessions },
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },
};
