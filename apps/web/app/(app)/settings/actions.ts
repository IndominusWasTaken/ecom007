"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hash, verify } from "@node-rs/argon2";
import { decryptSecret, encryptSecret } from "@ecom/core/crypto";
import { addDays, todayIn } from "@ecom/core/dates";
import { meta, shopify } from "@ecom/connectors";
import {
  adAccounts,
  and,
  audit,
  campaignStoreRules,
  connections,
  eq,
  getDb,
  markDirtyRange,
  regions,
  setSetting,
  sql,
  stores,
  users,
} from "@ecom/db";
import { destroySession, getSession, requestIp, requireUser } from "@/lib/auth";
import { enqueue, type QueueName } from "@/lib/jobs";

export interface ActionResult {
  ok: boolean;
  message: string;
}
type Prev = ActionResult | null;

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const optInt = (f: FormData, k: string) => (str(f, k) ? Number(str(f, k)) : null);

const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function done(message: string) {
  revalidatePath("/settings");
  return ok(message);
}

/** Queue a worker job; reports instead of throwing when the queue is unreachable. */
async function queue(name: QueueName, data: object | null = null): Promise<string | null> {
  try {
    await enqueue(name, data);
    return null;
  } catch (e) {
    return `Could not queue "${name}": ${(e as Error).message}. Is the worker running?`;
  }
}

async function track(userId: number, action: string, e: { entity?: string; entityId?: string | number; oldValue?: unknown; newValue?: unknown } = {}) {
  await audit(getDb(), { userId, action: `settings.${action}`, ip: await requestIp(), ...e });
}

function validTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// =====================================================================
// Regions & stores
// =====================================================================

export async function createRegion(_: Prev, f: FormData) {
  const user = await requireUser();
  const name = str(f, "name").slice(0, 64);
  const code = str(f, "code").toLowerCase();
  if (!name || !/^[a-z0-9-]{1,16}$/.test(code)) return fail("Enter a name and a short code (letters, digits, dash).");
  const db = getDb();
  const [{ max }] = (await db.execute<{ max: number }>(sql`select coalesce(max(sort_order), 0)::int max from regions`)).rows;
  const [row] = await db.insert(regions).values({ name, code, sortOrder: max + 1 }).onConflictDoNothing().returning();
  if (!row) return fail("A region with that name or code already exists.");
  await track(user.id, "region.create", { entity: "region", entityId: row.id, newValue: row });
  revalidatePath("/", "layout");
  return ok(`Region ${name} added.`);
}

export async function renameRegion(_: Prev, f: FormData) {
  const user = await requireUser();
  const id = Number(f.get("id"));
  const name = str(f, "name").slice(0, 64);
  if (!name) return fail("Name is required.");
  const db = getDb();
  const [old] = await db.select().from(regions).where(eq(regions.id, id));
  if (!old) return fail("Region not found.");
  try {
    await db.update(regions).set({ name }).where(eq(regions.id, id));
  } catch {
    return fail("Another region already has that name.");
  }
  await track(user.id, "region.rename", { entity: "region", entityId: id, oldValue: { name: old.name }, newValue: { name } });
  revalidatePath("/", "layout");
  return ok("Saved.");
}

/** Swap sort_order with the neighbour above or below. */
export async function moveRegion(id: number, dir: -1 | 1) {
  const user = await requireUser();
  const db = getDb();
  const list = await db.select().from(regions).orderBy(regions.sortOrder, regions.name);
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  // renumber densely so ties cannot block a move
  const order = list.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  await db.transaction(async (tx) => {
    for (const [n, rid] of order.entries()) await tx.update(regions).set({ sortOrder: n + 1 }).where(eq(regions.id, rid));
  });
  await track(user.id, "region.reorder", { entity: "region", entityId: id, newValue: { order } });
  revalidatePath("/", "layout");
}

export async function addStore(_: Prev, f: FormData) {
  const user = await requireUser();
  const name = str(f, "name").slice(0, 128);
  const regionId = Number(f.get("regionId"));
  const shopDomain = str(f, "shopDomain").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const clientId = str(f, "clientId");
  const clientSecret = str(f, "clientSecret");
  const currency = (str(f, "currency") || "USD").toUpperCase();
  const timeZone = str(f, "timeZone") || "UTC";
  const historyFrom = str(f, "historyFrom") || null;
  const color = str(f, "color");
  if (!name || !regionId) return fail("Name and region are required.");
  if (!DOMAIN_RE.test(shopDomain)) return fail("Shop domain must look like your-store.myshopify.com.");
  if (!clientId || !clientSecret) return fail("Client ID and Client secret are required.");
  if (!/^[A-Z]{3}$/.test(currency)) return fail("Currency must be a 3-letter code.");
  if (!validTimeZone(timeZone)) return fail("Unknown time zone.");
  if (historyFrom && !DATE_RE.test(historyFrom)) return fail("History start must be a date.");

  const db = getDb();
  const [dupe] = await db.select({ id: stores.id }).from(stores).where(eq(stores.shopDomain, shopDomain));
  if (dupe) return fail("A store with that domain already exists.");
  const store = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stores)
      .values({ name, regionId, shopDomain, currency, timeZone, historyFrom, pricesIncludeTax: f.get("pricesIncludeTax") === "on", color: HEX_RE.test(color) ? color : null })
      .returning();
    await tx.insert(connections).values({
      platform: "shopify",
      storeId: s.id,
      label: `Shopify · ${name}`,
      config: { clientIdHint: clientId.slice(-4) },
      secretsEnc: encryptSecret(JSON.stringify({ clientId, clientSecret })),
    });
    return s;
  });
  await track(user.id, "store.create", { entity: "store", entityId: store.id, newValue: { ...store, credentials: "(encrypted)" } });
  const err = await queue("history-reload", { kind: "shopify", id: store.id });
  revalidatePath("/", "layout");
  return err ? fail(`Store added, but ${err}`) : ok(`Store ${name} added. History load queued; currency and time zone are updated from Shopify on the first sync.`);
}

export async function updateStore(_: Prev, f: FormData) {
  const user = await requireUser();
  const id = Number(f.get("id"));
  const db = getDb();
  const [old] = await db.select().from(stores).where(eq(stores.id, id));
  if (!old) return fail("Store not found.");
  const color = str(f, "color");
  const next = {
    name: str(f, "name").slice(0, 128) || old.name,
    regionId: Number(f.get("regionId")) || old.regionId,
    currency: (str(f, "currency") || old.currency).toUpperCase(),
    timeZone: str(f, "timeZone") || old.timeZone,
    pricesIncludeTax: f.get("pricesIncludeTax") === "on",
    active: f.get("active") === "on",
    color: HEX_RE.test(color) ? color : old.color,
    historyFrom: str(f, "historyFrom") || null,
  };
  if (!/^[A-Z]{3}$/.test(next.currency)) return fail("Currency must be a 3-letter code.");
  if (!validTimeZone(next.timeZone)) return fail("Unknown time zone.");
  if (next.historyFrom && !DATE_RE.test(next.historyFrom)) return fail("History start must be a date.");
  await db.update(stores).set({ ...next, updatedAt: new Date() }).where(eq(stores.id, id));
  await track(user.id, "store.update", { entity: "store", entityId: id, oldValue: old, newValue: next });

  // currency, time zone and tax treatment change every derived number for the store
  const notes: string[] = [];
  if (next.currency !== old.currency || next.timeZone !== old.timeZone || next.pricesIncludeTax !== old.pricesIncludeTax) {
    const today = todayIn(next.timeZone);
    await markDirtyRange(db, id, addDays(today, -800), today);
    notes.push("metrics will be rebuilt");
    if (next.timeZone !== old.timeZone) notes.push("reload history so orders move to the new local dates");
  }
  if (next.historyFrom !== old.historyFrom) notes.push("reload history to apply the new start date");
  revalidatePath("/", "layout");
  return ok(`Saved${notes.length ? ` — ${notes.join("; ")}` : ""}.`);
}

// =====================================================================
// Connections
// =====================================================================

async function shopifyConnection(storeId: number) {
  const [c] = await getDb()
    .select()
    .from(connections)
    .where(and(eq(connections.platform, "shopify"), eq(connections.storeId, storeId)));
  return c ?? null;
}

async function metaConnection() {
  const [c] = await getDb().select().from(connections).where(eq(connections.platform, "meta")).orderBy(connections.id).limit(1);
  return c ?? null;
}

export async function replaceShopifyCredentials(_: Prev, f: FormData) {
  const user = await requireUser();
  const storeId = Number(f.get("storeId"));
  const clientId = str(f, "clientId");
  const clientSecret = str(f, "clientSecret");
  if (!clientId || !clientSecret) return fail("Client ID and Client secret are required.");
  const db = getDb();
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  if (!store) return fail("Store not found.");
  const secretsEnc = encryptSecret(JSON.stringify({ clientId, clientSecret }));
  const config = { clientIdHint: clientId.slice(-4) };
  const existing = await shopifyConnection(storeId);
  if (existing) {
    await db
      .update(connections)
      .set({ secretsEnc, config, tokenEnc: null, tokenExpiresAt: null, status: "new", lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, existing.id));
  } else {
    await db.insert(connections).values({ platform: "shopify", storeId, label: `Shopify · ${store.name}`, config, secretsEnc });
  }
  await track(user.id, "connection.shopify.credentials", { entity: "store", entityId: storeId, newValue: { clientId: `••••${config.clientIdHint}` } });
  return done("Credentials saved (encrypted). Test the connection to check them.");
}

/** Calls Shopify directly with the stored credentials and records the result on the connection. */
export async function testShopify(_: Prev, f: FormData) {
  const user = await requireUser();
  const storeId = Number(f.get("storeId"));
  const db = getDb();
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  const conn = await shopifyConnection(storeId);
  if (!store || !conn?.secretsEnc) return fail("Not connected — add credentials first.");
  const { clientId, clientSecret } = JSON.parse(decryptSecret(conn.secretsEnc)) as { clientId: string; clientSecret: string };
  const client = new shopify.ShopifyClient({ shopDomain: store.shopDomain, clientId, clientSecret }, shopify.memoryTokenCache());
  let result: ActionResult;
  try {
    const shop = await shopify.fetchShop(client);
    const missing = shopify.REQUIRED_SCOPES.filter((s) => client.grantedScopes.length && !client.grantedScopes.includes(s));
    await db.update(connections).set({ status: "ok", lastError: null, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, conn.id));
    // before the first sync, take currency, time zone and tax setting from Shopify
    if (!store.historyLoadedAt) {
      await db
        .update(stores)
        .set({ currency: shop.currencyCode, timeZone: shop.ianaTimezone, pricesIncludeTax: shop.taxesIncluded, shopifyPlan: shop.plan?.publicDisplayName ?? null, updatedAt: new Date() })
        .where(eq(stores.id, storeId));
    }
    const mismatch = store.historyLoadedAt && (shop.currencyCode !== store.currency || shop.ianaTimezone !== store.timeZone) ? ` Shopify reports ${shop.currencyCode} / ${shop.ianaTimezone}, which differs from the store settings.` : "";
    result = ok(
      `Connected to ${shop.name} (${shop.currencyCode}, ${shop.ianaTimezone}, prices ${shop.taxesIncluded ? "include" : "exclude"} tax${shop.plan?.publicDisplayName ? `, ${shop.plan.publicDisplayName}` : ""}).` +
        (missing.length ? ` Missing scopes: ${missing.join(", ")}.` : "") +
        mismatch,
    );
  } catch (e) {
    const msg = (e as Error).message.slice(0, 2000);
    await db.update(connections).set({ status: "error", lastError: msg, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, conn.id));
    result = fail(`Shopify test failed: ${msg.slice(0, 300)}`);
  }
  await track(user.id, "connection.shopify.test", { entity: "store", entityId: storeId, newValue: { ok: result.ok } });
  revalidatePath("/settings");
  return result;
}

const SYNC_QUEUES: QueueName[] = ["shopify-orders", "shopify-products", "shopify-sessions", "shopify-fees", "shopify-reconcile", "meta-accounts", "meta-structure", "meta-today", "meta-trailing", "fx-ecb", "backup"];

export async function syncNow(_: Prev, f: FormData) {
  const user = await requireUser();
  const name = str(f, "queue") as QueueName;
  if (!SYNC_QUEUES.includes(name)) return fail("Unknown job.");
  const err = await queue(name);
  await track(user.id, "sync.enqueue", { entity: "queue", entityId: name });
  return err ? fail(err) : done(`Queued ${name}. Progress shows under Sync status.`);
}

export async function reloadHistory(_: Prev, f: FormData) {
  const user = await requireUser();
  const kind = str(f, "kind") === "meta" ? "meta" : "shopify";
  const id = Number(f.get("id"));
  if (!id) return fail("Missing id.");
  const err = await queue("history-reload", { kind, id });
  await track(user.id, "history.reload", { entity: kind === "meta" ? "ad_account" : "store", entityId: id });
  return err ? fail(err) : done("History reload queued. It can take a while for large stores.");
}

export async function saveMetaToken(_: Prev, f: FormData) {
  const user = await requireUser();
  const token = str(f, "token");
  if (token.length < 20) return fail("Paste the full System User token.");
  const db = getDb();
  const secretsEnc = encryptSecret(JSON.stringify({ token }));
  const existing = await metaConnection();
  const config = { ...existing?.config, tokenHint: token.slice(-4) };
  if (existing) await db.update(connections).set({ secretsEnc, config, status: "new", lastError: null, updatedAt: new Date() }).where(eq(connections.id, existing.id));
  else await db.insert(connections).values({ platform: "meta", label: "Meta · System User", secretsEnc, config });
  await track(user.id, "connection.meta.token", { entity: "connection", entityId: existing?.id ?? "meta" });
  return done("Token saved (encrypted). Test it, then discover ad accounts.");
}

export async function testMeta(_: Prev, _f: FormData) {
  const user = await requireUser();
  const conn = await metaConnection();
  if (!conn?.secretsEnc) return fail("Not connected — add a token first.");
  const { token } = JSON.parse(decryptSecret(conn.secretsEnc)) as { token: string };
  const db = getDb();
  let result: ActionResult;
  try {
    const list = await meta.listAdAccounts({ token });
    await db.update(connections).set({ status: "ok", lastError: null, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, conn.id));
    result = ok(`Token works: ${list.length} ad account${list.length === 1 ? "" : "s"} visible${list.length ? ` (${list.slice(0, 5).map((a) => a.name).join(", ")}${list.length > 5 ? "…" : ""})` : ""}.`);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 2000);
    await db.update(connections).set({ status: "error", lastError: msg, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, conn.id));
    result = fail(`Meta test failed: ${msg.slice(0, 300)}`);
  }
  await track(user.id, "connection.meta.test", { entity: "connection", entityId: conn.id, newValue: { ok: result.ok } });
  revalidatePath("/settings");
  return result;
}

// =====================================================================
// Ad account mapping
// =====================================================================

async function afterMapping(adAccountId?: number) {
  const err = await queue("meta-remap", adAccountId ? { adAccountId } : null);
  revalidatePath("/", "layout");
  return err ? fail(`Saved, but ${err}`) : ok("Saved. The worker is re-mapping spend; numbers update within a minute or two.");
}

export async function setAccountStore(_: Prev, f: FormData) {
  const user = await requireUser();
  const id = Number(f.get("id"));
  const storeId = optInt(f, "storeId");
  const db = getDb();
  const [old] = await db.select().from(adAccounts).where(eq(adAccounts.id, id));
  if (!old) return fail("Ad account not found.");
  await db.update(adAccounts).set({ storeId, updatedAt: new Date() }).where(eq(adAccounts.id, id));
  await track(user.id, "ad_account.store", { entity: "ad_account", entityId: id, oldValue: { storeId: old.storeId }, newValue: { storeId } });
  return afterMapping(id);
}

export async function setAccountEnabled(_: Prev, f: FormData) {
  const user = await requireUser();
  const id = Number(f.get("id"));
  const enabled = f.get("enabled") === "on";
  const db = getDb();
  const [old] = await db.select().from(adAccounts).where(eq(adAccounts.id, id));
  if (!old) return fail("Ad account not found.");
  await db.update(adAccounts).set({ enabled, updatedAt: new Date() }).where(eq(adAccounts.id, id));
  await track(user.id, "ad_account.enabled", { entity: "ad_account", entityId: id, oldValue: { enabled: old.enabled }, newValue: { enabled } });
  return afterMapping(id);
}

export async function addCampaignRule(_: Prev, f: FormData) {
  const user = await requireUser();
  const adAccountId = optInt(f, "adAccountId");
  const storeId = Number(f.get("storeId"));
  const priority = Number(str(f, "priority") || 100);
  const mode = str(f, "mode");
  const pattern = mode === "pattern" ? str(f, "pattern").slice(0, 255) : null;
  const campaignExternalId = mode === "campaign" ? str(f, "campaign") || null : null;
  if (!storeId) return fail("Choose a store.");
  if (!Number.isInteger(priority) || priority < 0 || priority > 100000) return fail("Priority must be a whole number (lower runs first).");
  if (mode === "pattern") {
    if (!pattern) return fail("Enter the text the campaign name contains, or a /regex/.");
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      try {
        new RegExp(pattern.slice(1, pattern.lastIndexOf("/")), pattern.slice(pattern.lastIndexOf("/") + 1) || "i");
      } catch {
        return fail("That regular expression is not valid.");
      }
    }
  } else if (!campaignExternalId) return fail("Choose a campaign.");
  const [row] = await getDb().insert(campaignStoreRules).values({ adAccountId, storeId, priority, pattern, campaignExternalId }).returning();
  await track(user.id, "campaign_rule.create", { entity: "campaign_rule", entityId: row.id, newValue: row });
  return afterMapping();
}

export async function deleteCampaignRule(_: Prev, f: FormData) {
  const user = await requireUser();
  const id = Number(f.get("id"));
  const [old] = await getDb().delete(campaignStoreRules).where(eq(campaignStoreRules.id, id)).returning();
  if (!old) return fail("Rule not found.");
  await track(user.id, "campaign_rule.delete", { entity: "campaign_rule", entityId: id, oldValue: old });
  return afterMapping();
}

// =====================================================================
// Users & security
// =====================================================================

export async function changePassword(_: Prev, f: FormData) {
  const user = await requireUser();
  const current = String(f.get("current") ?? "");
  const next = String(f.get("next") ?? "");
  const repeat = String(f.get("repeat") ?? "");
  if (!(await verify(user.passwordHash, current).catch(() => false))) {
    await track(user.id, "password.fail", { entity: "user", entityId: user.id });
    return fail("Current password is wrong.");
  }
  if (next.length < 12) return fail("The new password must be at least 12 characters.");
  if (next !== repeat) return fail("The new passwords do not match.");
  if (next === current) return fail("Choose a password different from the current one.");
  const db = getDb();
  await db.update(users).set({ passwordHash: await hash(next, ARGON2_OPTS), updatedAt: new Date() }).where(eq(users.id, user.id));
  // a new password ends every other session
  const s = await getSession();
  await db.execute(sql`delete from auth_sessions where user_id = ${user.id} and id <> ${s?.id ?? ""}`);
  await track(user.id, "password.change", { entity: "user", entityId: user.id });
  return done("Password changed. Other sessions were signed out.");
}

export async function resetOwnTwoFactor(_: Prev, f: FormData) {
  const user = await requireUser();
  if (!(await verify(user.passwordHash, String(f.get("current") ?? "")).catch(() => false))) return fail("Current password is wrong.");
  const db = getDb();
  await db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, updatedAt: new Date() }).where(eq(users.id, user.id));
  await track(user.id, "2fa.reset", { entity: "user", entityId: user.id });
  await db.execute(sql`delete from auth_sessions where user_id = ${user.id}`);
  await destroySession();
  redirect("/login");
}

export async function signOutOtherSessions(_: Prev, _f: FormData) {
  const user = await requireUser();
  const s = await getSession();
  const res = await getDb().execute(sql`delete from auth_sessions where user_id = ${user.id} and id <> ${s?.id ?? ""}`);
  await track(user.id, "sessions.signout_others", { entity: "user", entityId: user.id, newValue: { removed: res.rowCount } });
  return done(`Signed out ${res.rowCount ?? 0} other session${res.rowCount === 1 ? "" : "s"}.`);
}

// =====================================================================
// Currencies & tax, backups
// =====================================================================

export async function saveMoneySettings(_: Prev, f: FormData) {
  const user = await requireUser();
  const currency = str(f, "defaultCurrency");
  const pct = Number(str(f, "taxPercent").replace(",", ".") || 0);
  if (currency !== "USD" && currency !== "EUR") return fail("Choose USD or EUR.");
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return fail("Tax rate must be between 0 and 99.99 %.");
  const rate = Math.round(pct * 100) / 10000; // percent → fraction, 2 decimals of a percent
  const db = getDb();
  const before = (await db.execute<{ key: string; value: unknown }>(sql`select key, value from app_settings where key in ('default_currency', 'profit_tax_rate')`)).rows;
  await setSetting(db, "default_currency", currency);
  await setSetting(db, "profit_tax_rate", rate);
  await track(user.id, "money.update", { entity: "app_settings", oldValue: Object.fromEntries(before.map((r) => [r.key, r.value])), newValue: { default_currency: currency, profit_tax_rate: rate } });
  revalidatePath("/", "layout");
  return ok(`Saved. Profit tax ${rate ? `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")} %` : "off"}, default currency ${currency}.`);
}
