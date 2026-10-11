import { decryptSecret, encryptSecret } from "@ecom/core/crypto";
import { HISTORY_MONTHS } from "@ecom/core/config";
import { addMonths, todayIn } from "@ecom/core/dates";
import { connections, eq, and, getDb, stores, type Db } from "@ecom/db";
import { shopify } from "@ecom/connectors";

export type StoreRow = typeof stores.$inferSelect;

export async function activeStores(db: Db = getDb()): Promise<StoreRow[]> {
  return db.select().from(stores).where(eq(stores.active, true));
}

/** Persisted, encrypted token cache in connections.token_enc (Shopify's 24 h tokens). */
function dbTokenCache(db: Db, connectionId: number): shopify.TokenCache {
  return {
    async get() {
      const [c] = await db.select().from(connections).where(eq(connections.id, connectionId));
      if (!c?.tokenEnc || !c.tokenExpiresAt) return null;
      return { token: decryptSecret(c.tokenEnc), expiresAt: c.tokenExpiresAt };
    },
    async set(token, expiresAt) {
      await db.update(connections).set({ tokenEnc: encryptSecret(token), tokenExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(connections.id, connectionId));
    },
  };
}

export interface ShopifySecrets {
  clientId: string;
  clientSecret: string;
}

export async function shopifyClientFor(db: Db, store: StoreRow) {
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.platform, "shopify"), eq(connections.storeId, store.id)));
  if (!conn?.secretsEnc) throw new Error(`Store ${store.name} has no Shopify connection. Add it in Settings → Connections.`);
  const secrets = JSON.parse(decryptSecret(conn.secretsEnc)) as ShopifySecrets;
  const client = new shopify.ShopifyClient({ shopDomain: store.shopDomain, clientId: secrets.clientId, clientSecret: secrets.clientSecret }, dbTokenCache(db, conn.id));
  return { client, connection: conn };
}

export async function metaConnections(db: Db) {
  const rows = await db.select().from(connections).where(eq(connections.platform, "meta"));
  return rows
    .filter((c) => c.secretsEnc && c.status !== "disabled")
    .map((c) => ({ connection: c, token: (JSON.parse(decryptSecret(c.secretsEnc!)) as { token: string }).token }));
}

export async function setConnectionStatus(db: Db, id: number, ok: boolean, error?: string) {
  await db
    .update(connections)
    .set({ status: ok ? "ok" : "error", lastError: ok ? null : (error ?? "").slice(0, 2000), lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(connections.id, id));
}

/** First date a history load reaches back to: the later of the store's setting and HISTORY_MONTHS. */
export function historyStart(store: Pick<StoreRow, "historyFrom" | "timeZone">): string {
  const limit = addMonths(todayIn(store.timeZone), -HISTORY_MONTHS);
  return store.historyFrom && store.historyFrom > limit ? store.historyFrom : limit;
}
