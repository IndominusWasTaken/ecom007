import { addDays, todayIn } from "@ecom/core/dates";
import { META_TRAILING_DAYS, RECONCILE_TOLERANCE } from "@ecom/core/config";
import { D } from "@ecom/core/money";
import { fetchEcbRates, meta, shopify } from "@ecom/connectors";
import {
  adAccounts,
  and,
  eq,
  failRun,
  finishRun,
  fxRates,
  getCursor,
  getDb,
  isNotNull,
  markDirty,
  markDirtyRange,
  paymentsBalanceTxns,
  products,
  reconciliation,
  sessionsDaily,
  setCursor,
  shopifyDailyReport,
  sql,
  startRun,
  stores,
  variants,
  type Db,
} from "@ecom/db";
import { activeStores, historyStart, metaConnections, setConnectionStatus, shopifyClientFor, type StoreRow } from "./context";
import { shopifySink, recomputeFirstOrders } from "./shopifySink";
import { rebuildDirty } from "./rebuild";
import { discoverAccounts, downloadPendingMedia, insightsSink, syncStructure } from "./meta";
import { refreshDomainExpiries, runRenewals } from "./expenses";
import { runBackup } from "./backup";
import { alert } from "./notifier";
import { log } from "./log";

/** Wraps a job: logs start/end/rows/errors to sync_runs and raises an alert on failure. */
export async function tracked(job: string, source: string, fn: () => Promise<number | void>) {
  const db = getDb();
  const id = await startRun(db, job, source);
  try {
    const rows = (await fn()) ?? 0;
    await finishRun(db, id, rows);
    return rows;
  } catch (e) {
    await failRun(db, id, e);
    log.error(`job ${job} failed`, { source, error: (e as Error).message });
    await alert({ kind: "sync_error", severity: "error", title: `Sync failed: ${job} (${source})`, body: (e as Error).message.slice(0, 500), link: "/settings?tab=sync", dedupeKey: `syncfail:${job}:${source}:${new Date().toISOString().slice(0, 13)}` });
    throw e;
  }
}

async function forEachStore(job: string, fn: (db: Db, store: StoreRow, client: shopify.ShopifyClient) => Promise<number>) {
  const db = getDb();
  let failures = 0;
  for (const store of await activeStores(db)) {
    try {
      await tracked(job, `shopify:${store.id}`, async () => {
        const { client, connection } = await shopifyClientFor(db, store);
        try {
          const n = await fn(db, store, client);
          await setConnectionStatus(db, connection.id, true);
          return n;
        } catch (e) {
          await setConnectionStatus(db, connection.id, false, (e as Error).message);
          throw e;
        }
      });
    } catch {
      failures++;
    }
  }
  return failures;
}

// ---------------- Shopify ----------------

export async function shopifyHistory(storeId?: number) {
  const db = getDb();
  for (const store of await activeStores(db)) {
    if (storeId && store.id !== storeId) continue;
    if (store.historyLoadedAt && !storeId) continue;
    await tracked("shopify.history", `shopify:${store.id}`, async () => {
      const { client } = await shopifyClientFor(db, store);
      const shop = await shopify.fetchShop(client);
      await db.update(stores).set({ currency: shop.currencyCode, timeZone: shop.ianaTimezone, shopifyPlan: shop.plan?.publicDisplayName ?? null }).where(eq(stores.id, store.id));
      const s = { ...store, currency: shop.currencyCode, timeZone: shop.ianaTimezone };
      const since = historyStart(s);
      const key = `shopify:history:${store.id}`;
      const res = await shopify.loadOrderHistory(client, shopifySink(s), { since, cursor: await getCursor(db, key), onProgress: (m) => log.info(m, { store: store.name }) });
      await setCursor(db, `shopify:orders:${store.id}`, new Date().toISOString());
      await syncVariantsFor(db, s, client, null);
      await syncFeesFor(db, s, client, since);
      await syncSessionsFor(db, s, client, since);
      await recomputeFirstOrders(db, store.id);
      await markDirtyRange(db, store.id, since, todayIn(store.timeZone));
      await db.update(stores).set({ historyLoadedAt: new Date() }).where(eq(stores.id, store.id));
      return res.rows;
    });
  }
}

export async function shopifyOrders() {
  return forEachStore("shopify.orders", async (db, store, client) => {
    if (!store.historyLoadedAt) return 0; // history job runs first
    const key = `shopify:orders:${store.id}`;
    const res = await shopify.syncOrders(client, shopifySink(store), await getCursor(db, key), historyStart(store));
    if (res.cursor) await setCursor(db, key, res.cursor);
    if (res.rows) await recomputeFirstOrders(db, store.id);
    return res.rows;
  });
}

async function syncVariantsFor(db: Db, store: StoreRow, client: shopify.ShopifyClient, since: string | null) {
  const list = await shopify.fetchVariants(client, since);
  for (const v of list) {
    const [p] = await db
      .insert(products)
      .values({ storeId: store.id, shopifyId: v.productShopifyId, title: v.productTitle, status: v.productStatus, productType: v.productType, vendor: v.vendor, imageUrl: v.imageUrl, updatedAtShopify: v.productUpdatedAt ? new Date(v.productUpdatedAt) : null })
      .onConflictDoUpdate({
        target: [products.storeId, products.shopifyId],
        set: { title: v.productTitle, status: v.productStatus, productType: v.productType, vendor: v.vendor, imageUrl: v.imageUrl, syncedAt: new Date() },
      })
      .returning({ id: products.id });
    const values = {
      storeId: store.id,
      productId: p.id,
      shopifyId: v.shopifyId,
      productShopifyId: v.productShopifyId,
      sku: v.sku,
      title: v.title,
      price: v.price,
      shopifyCost: v.shopifyCost,
      weightGrams: v.weightGrams,
      inventoryQuantity: v.inventoryQuantity,
      raw: v.raw as object,
      syncedAt: new Date(),
    };
    const before = await db.select({ c: variants.shopifyCost }).from(variants).where(and(eq(variants.storeId, store.id), eq(variants.shopifyId, v.shopifyId)));
    await db.insert(variants).values(values).onConflictDoUpdate({ target: [variants.storeId, variants.shopifyId], set: values });
    // Shopify's cost changed: orders that relied on it need new COGS
    if (before[0] && (before[0].c ?? null) !== (v.shopifyCost ?? null)) {
      const ds = await db.execute<any>(sql`select distinct o.local_date::text d from order_lines l join orders o on o.id = l.order_id
        where l.store_id = ${store.id} and l.variant_shopify_id = ${v.shopifyId} and l.cost_source in ('shopify','missing','fallback')`);
      await markDirty(db, store.id, ds.rows.map((r: any) => r.d));
    }
  }
  return list.length;
}

export async function shopifyProducts() {
  return forEachStore("shopify.products", async (db, store, client) => {
    const key = `shopify:variants:${store.id}`;
    const since = await getCursor(db, key);
    const started = new Date().toISOString();
    const n = await syncVariantsFor(db, store, client, since);
    await setCursor(db, key, started);
    return n;
  });
}

async function syncFeesFor(db: Db, store: StoreRow, client: shopify.ShopifyClient, sinceDate: string) {
  let list: shopify.BalanceTxnRecord[];
  try {
    list = await shopify.fetchBalanceTransactions(client, sinceDate);
  } catch (e) {
    // Store without Shopify Payments, or scope not granted: fee rules apply instead
    log.warn("payments fees unavailable", { store: store.name, error: (e as Error).message });
    return 0;
  }
  const orderIds = new Set<string>();
  for (const t of list) {
    const v = {
      storeId: store.id,
      shopifyId: t.shopifyId,
      type: t.type,
      test: t.test,
      amount: t.amount,
      fee: t.fee,
      net: t.net,
      currency: t.currency,
      transactionDate: new Date(t.transactionDate),
      orderShopifyId: t.orderShopifyId,
      sourceOrderTransactionId: t.sourceOrderTransactionId,
      raw: t.raw as object,
    };
    await db.insert(paymentsBalanceTxns).values(v).onConflictDoUpdate({ target: [paymentsBalanceTxns.storeId, paymentsBalanceTxns.shopifyId], set: v });
    if (t.orderShopifyId) orderIds.add(t.orderShopifyId);
  }
  if (orderIds.size) {
    const ds = await db.execute<any>(sql`select distinct local_date::text d from orders where store_id = ${store.id} and shopify_id = any(${sql.param([...orderIds])}::text[])`);
    await markDirty(db, store.id, ds.rows.map((r: any) => r.d));
  }
  return list.length;
}

export async function shopifyFees() {
  return forEachStore("shopify.fees", (db, store, client) => syncFeesFor(db, store, client, addDays(todayIn(store.timeZone), -7)));
}

async function syncSessionsFor(db: Db, store: StoreRow, client: shopify.ShopifyClient, from: string) {
  const to = todayIn(store.timeZone);
  let rows: shopify.SessionsRow[];
  try {
    rows = await shopify.fetchSessions(client, from, to);
  } catch (e) {
    await db.update(stores).set({ sessionsStatus: "not_connected" }).where(eq(stores.id, store.id));
    log.warn("sessions not connected", { store: store.name, error: (e as Error).message });
    return 0;
  }
  for (const r of rows) {
    const v = { storeId: store.id, date: r.date, sessions: r.sessions, addedToCart: r.addedToCart, reachedCheckout: r.reachedCheckout, completedCheckout: r.completedCheckout, raw: r.raw as object, syncedAt: new Date() };
    await db.insert(sessionsDaily).values(v).onConflictDoUpdate({ target: [sessionsDaily.storeId, sessionsDaily.date], set: v });
  }
  await db.update(stores).set({ sessionsStatus: "ok" }).where(eq(stores.id, store.id));
  await markDirty(db, store.id, rows.map((r) => r.date));
  return rows.length;
}

export async function shopifySessions() {
  return forEachStore("shopify.sessions", (db, store, client) => syncSessionsFor(db, store, client, addDays(todayIn(store.timeZone), -3)));
}

/** Nightly: our total sales and orders per store-day vs Shopify's own sales report. */
export async function shopifyReconcile(days = 7) {
  return forEachStore("shopify.reconcile", async (db, store, client) => {
    const to = addDays(todayIn(store.timeZone), -1);
    const from = addDays(to, -(days - 1));
    const report = await shopify.fetchSalesReport(client, from, to);
    let flagged = 0;
    for (const r of report) {
      await db
        .insert(shopifyDailyReport)
        .values({ storeId: store.id, date: r.date, totalSales: r.totalSales, orders: r.orders, raw: r.raw as object })
        .onConflictDoUpdate({ target: [shopifyDailyReport.storeId, shopifyDailyReport.date], set: { totalSales: r.totalSales, orders: r.orders, raw: r.raw as object, syncedAt: new Date() } });
      const ours = await db.execute<any>(sql`select (gross_sales - discounts - sales_reversals + shipping_gross - shipping_refunded + return_fees + order_taxes - tax_refunded)::text total_sales, orders::int orders
        from daily_store_metrics m join stores s on s.id = m.store_id where m.store_id = ${store.id} and m.date = ${r.date} and m.currency = s.currency`);
      const o = ours.rows[0] ?? { total_sales: "0", orders: 0 };
      const theirs = D(r.totalSales);
      const salesGap = theirs.isZero() ? (D(o.total_sales).isZero() ? 0 : 1) : D(o.total_sales).minus(theirs).abs().div(theirs.abs()).toNumber();
      const ordersGap = r.orders === 0 ? (o.orders === 0 ? 0 : 1) : Math.abs(o.orders - r.orders) / r.orders;
      const isFlagged = salesGap > RECONCILE_TOLERANCE || ordersGap > RECONCILE_TOLERANCE;
      if (isFlagged) flagged++;
      const v = { storeId: store.id, date: r.date, ourTotalSales: o.total_sales, shopifyTotalSales: r.totalSales, ourOrders: o.orders, shopifyOrders: r.orders, salesGapPct: salesGap.toFixed(6), ordersGapPct: ordersGap.toFixed(6), flagged: isFlagged, checkedAt: new Date() };
      await db.insert(reconciliation).values(v).onConflictDoUpdate({ target: [reconciliation.storeId, reconciliation.date], set: v });
    }
    if (flagged) {
      await alert({
        kind: "reconcile",
        severity: "warning",
        title: `${store.name}: ${flagged} day(s) differ from Shopify by more than ${(RECONCILE_TOLERANCE * 100).toFixed(1)}%`,
        link: "/settings?tab=sync",
        dedupeKey: `reconcile:${store.id}:${to}`,
      });
    }
    return report.length;
  });
}

// ---------------- Meta ----------------

export async function metaAccounts() {
  const db = getDb();
  let n = 0;
  for (const { connection, token } of await metaConnections(db)) {
    n += await tracked("meta.accounts", `meta:conn:${connection.id}`, async () => {
      try {
        const c = await discoverAccounts(db, connection.id, token);
        await setConnectionStatus(db, connection.id, true);
        return c;
      } catch (e) {
        await setConnectionStatus(db, connection.id, false, (e as Error).message);
        throw e;
      }
    });
  }
  return n;
}

async function forEachAdAccount(job: string, fn: (db: Db, acct: typeof adAccounts.$inferSelect, token: string) => Promise<number>) {
  const db = getDb();
  const conns = await metaConnections(db);
  const accts = await db.select().from(adAccounts).where(and(eq(adAccounts.platform, "meta"), eq(adAccounts.enabled, true), isNotNull(adAccounts.connectionId)));
  for (const a of accts) {
    const conn = conns.find((c) => c.connection.id === a.connectionId);
    if (!conn) continue;
    try {
      await tracked(job, `meta:${a.id}`, () => fn(db, a, conn.token));
    } catch {
      /* recorded */
    }
  }
}

export async function metaStructure() {
  await forEachAdAccount("meta.structure", async (db, a, token) => {
    const n = await syncStructure(db, a, token);
    await downloadPendingMedia(db, token, 200);
    return n;
  });
}

export async function metaToday() {
  await forEachAdAccount("meta.today", async (db, a, token) => {
    if (!a.historyLoadedAt) return 0;
    const today = todayIn(a.timeZone);
    const rows = await meta.insightsSync({ token }, a.externalId, addDays(today, -1), today);
    return insightsSink(db).insights(a.externalId, rows);
  });
}

export async function metaTrailing() {
  await forEachAdAccount("meta.trailing", async (db, a, token) => {
    if (!a.historyLoadedAt) return 0;
    const today = todayIn(a.timeZone);
    const rows = await meta.insightsAsync({ token }, a.externalId, addDays(today, -META_TRAILING_DAYS), today);
    return insightsSink(db).insights(a.externalId, rows);
  });
}

export async function metaHistory(accountId?: number) {
  await forEachAdAccount("meta.history", async (db, a, token) => {
    if (accountId && a.id !== accountId) return 0;
    if (a.historyLoadedAt && !accountId) return 0;
    await syncStructure(db, a, token);
    const key = `meta:history:${a.id}`;
    let total = 0;
    const since = addDays(todayIn(a.timeZone), -Math.round(30.44 * Number(process.env.HISTORY_MONTHS ?? 24)));
    for (;;) {
      const res = await meta.metaConnector.loadHistory({ token, account: a.externalId }, insightsSink(db), { since, cursor: await getCursor(db, key), onProgress: (m) => log.info(m, { account: a.name }) });
      total += res.rows;
      await setCursor(db, key, res.cursor ?? "done");
      if (res.done) break;
    }
    await db.update(adAccounts).set({ historyLoadedAt: new Date() }).where(eq(adAccounts.id, a.id));
    await downloadPendingMedia(db, token, 500);
    return total;
  });
}

// ---------------- FX, metrics, renewals, backups ----------------

export async function fxDaily(which: "daily" | "90d" | "hist" = "90d") {
  return tracked("fx.ecb", "fx", async () => {
    const db = getDb();
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from fx_rates`)).rows;
    if (n === 0) which = "hist"; // first run: full history so old orders convert at their own day's rate
    const rates = await fetchEcbRates(which, ["USD", "GBP", "BGN", "CAD", "AUD", "PLN", "RON", "CHF", "SEK", "DKK", "CZK", "HUF"]);
    const changed = new Set<string>();
    for (let i = 0; i < rates.length; i += 1000) {
      const chunk = rates.slice(i, i + 1000);
      const res = await db.execute<any>(sql`insert into fx_rates (date, currency, per_eur)
        select * from unnest(${sql.param(chunk.map((r) => r.date))}::date[], ${sql.param(chunk.map((r) => r.currency))}::text[], ${sql.param(chunk.map((r) => r.perEur))}::numeric[])
        on conflict (date, currency) do update set per_eur = excluded.per_eur where fx_rates.per_eur <> excluded.per_eur
        returning date::text d`);
      for (const r of res.rows) changed.add(r.d);
    }
    // a new or corrected rate changes converted amounts from that date until the next rate
    if (changed.size) {
      const first = [...changed].sort()[0];
      await markDirtyRange(db, null, first, todayIn("UTC"));
    }
    return rates.length;
  });
}

export async function metricsRebuild() {
  return tracked("metrics.rebuild", "metrics", async () => {
    let total = 0;
    for (;;) {
      const n = await rebuildDirty(getDb());
      total += n;
      if (n === 0) break;
    }
    return total;
  });
}

export const renewals = () => tracked("expenses.renewals", "expenses", () => runRenewals());
export const domains = () => tracked("expenses.domains", "expenses", () => refreshDomainExpiries());
export const backup = () => tracked("backup", "backup", () => runBackup());

/** Raise an alert when a source has not succeeded for over an hour. */
export async function syncMonitor() {
  const db = getDb();
  const res = await db.execute<any>(sql`select source, max(finished_at) filter (where status='ok') last_ok from sync_runs
    where job in ('shopify.orders','meta.today') group by source`);
  for (const r of res.rows) {
    if (!r.last_ok || Date.now() - new Date(r.last_ok).getTime() > 60 * 60_000) {
      await alert({ kind: "sync_error", severity: "warning", title: `${r.source} has not synced for over an hour`, link: "/settings?tab=sync", dedupeKey: `stale:${r.source}:${new Date().toISOString().slice(0, 13)}` });
    }
  }
  return res.rows.length;
}

export { fxRates };
