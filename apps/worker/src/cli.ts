import "./env";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { hash } from "@node-rs/argon2";
import { encryptSecret } from "@ecom/core/crypto";
import { addDays, todayIn } from "@ecom/core/dates";
import { meta, shopify } from "@ecom/connectors";
import { closeDb, connections, eq, and, getDb, markDirtyRange, regions, stores, sql, users, audit } from "@ecom/db";
import * as jobs from "./jobs";
import { decryptBackup } from "./backup";
import { remapAccount } from "./meta";
import { ARGON2_OPTS } from "./cliShared";

const MAX_USERS = Number(process.env.MAX_USERS ?? 2);

function ask(q: string, hidden = false): Promise<string> {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const w = (rl as unknown as { _writeToOutput: (s: string) => void });
      w._writeToOutput = (s: string) => {
        if (s.includes(q)) process.stdout.write(s);
        else process.stdout.write("*");
      };
    }
    rl.question(q, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      res(a.trim());
    });
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function readPassword(): Promise<string> {
  const p1 = process.env.NEW_USER_PASSWORD ?? (await ask("Password (min 12 chars): ", true));
  if (p1.length < 12) throw new Error("Password must be at least 12 characters");
  if (!process.env.NEW_USER_PASSWORD) {
    const p2 = await ask("Repeat password: ", true);
    if (p1 !== p2) throw new Error("Passwords do not match");
  }
  return p1;
}

const commands: Record<string, { help: string; run: (args: string[]) => Promise<void> }> = {
  "create-user": {
    help: "create-user <username> [--name 'Display name']   Create one of the two dashboard users",
    async run([username]) {
      if (!username) throw new Error("Usage: create-user <username>");
      const db = getDb();
      const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from users`)).rows;
      if (n >= MAX_USERS) throw new Error(`There are already ${n} users (MAX_USERS=${MAX_USERS}).`);
      const passwordHash = await hash(await readPassword(), ARGON2_OPTS);
      await db.insert(users).values({ username: username.toLowerCase(), displayName: arg("name") ?? username, passwordHash });
      await audit(db, { action: "user.create", entity: "user", entityId: username });
      console.log(`User ${username} created. Two-factor setup is required at first login.`);
    },
  },
  "set-password": {
    help: "set-password <username>                      Change a user's password",
    async run([username]) {
      const db = getDb();
      const passwordHash = await hash(await readPassword(), ARGON2_OPTS);
      const r = await db.update(users).set({ passwordHash, failedAttempts: 0, lockedUntil: null }).where(eq(users.username, username.toLowerCase())).returning({ id: users.id });
      if (!r.length) throw new Error("No such user");
      await db.execute(sql`delete from auth_sessions where user_id = ${r[0].id}`);
      console.log("Password changed; existing sessions signed out.");
    },
  },
  "reset-2fa": {
    help: "reset-2fa <username>                          Clear two-factor; user re-enrolls at next login",
    async run([username]) {
      const db = getDb();
      const r = await db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.username, username.toLowerCase())).returning({ id: users.id });
      if (!r.length) throw new Error("No such user");
      await db.execute(sql`delete from auth_sessions where user_id = ${r[0].id}`);
      console.log("Two-factor reset.");
    },
  },
  unlock: {
    help: "unlock <username>                             Clear a lockout after failed logins",
    async run([username]) {
      await getDb().update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.username, username.toLowerCase()));
      console.log("Unlocked.");
    },
  },
  "phase0-check": {
    help: "phase0-check                                  Fetch one real order per store and one day of ad spend (reads .env)",
    async run() {
      const keys = (process.env.SHOPIFY_STORES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!keys.length) console.log("SHOPIFY_STORES is empty: nothing to check for Shopify.");
      for (const k of keys) {
        const domain = process.env[`SHOPIFY_${k}_DOMAIN`];
        const clientId = process.env[`SHOPIFY_${k}_CLIENT_ID`];
        const clientSecret = process.env[`SHOPIFY_${k}_CLIENT_SECRET`];
        if (!domain || !clientId || !clientSecret) {
          console.log(`✗ ${k}: set SHOPIFY_${k}_DOMAIN, SHOPIFY_${k}_CLIENT_ID and SHOPIFY_${k}_CLIENT_SECRET`);
          continue;
        }
        try {
          const client = new shopify.ShopifyClient({ shopDomain: domain, clientId, clientSecret });
          const shop = await shopify.fetchShop(client);
          const order = await shopify.probeLatestOrder(client);
          const missing = shopify.REQUIRED_SCOPES.filter((s) => !client.grantedScopes.includes(s));
          console.log(`✓ ${k}: ${shop.name} (${shop.currencyCode}, ${shop.ianaTimezone}, prices include tax: ${shop.taxesIncluded})`);
          console.log(`  latest order: ${order ? `${order.name} ${order.createdAt} ${order.totalPriceSet.shopMoney.amount} ${order.totalPriceSet.shopMoney.currencyCode}` : "none"}`);
          console.log(`  granted scopes: ${client.grantedScopes.join(", ") || "(unknown)"}`);
          if (missing.length) console.log(`  ! missing scopes: ${missing.join(", ")}`);
          try {
            const t = todayIn(shop.ianaTimezone);
            const s = await shopify.fetchSessions(client, addDays(t, -1), addDays(t, -1));
            console.log(`  sessions yesterday: ${s[0]?.sessions ?? 0} (ShopifyQL OK)`);
          } catch (e) {
            console.log(`  ! sessions not available: ${(e as Error).message}`);
          }
        } catch (e) {
          console.log(`✗ ${k}: ${(e as Error).message}`);
        }
      }
      const token = process.env.META_SYSTEM_USER_TOKEN;
      if (!token) console.log("META_SYSTEM_USER_TOKEN is empty: nothing to check for Meta.");
      else {
        try {
          const accts = await meta.listAdAccounts({ token });
          console.log(`✓ Meta: ${accts.length} ad account(s)`);
          for (const a of accts) {
            const y = addDays(todayIn(a.timezone_name), -1);
            const rows = await meta.insightsSync({ token }, a.id, y, y);
            const spend = rows.reduce((s, r) => s + Number(r.spend), 0);
            console.log(`  ${a.id} ${a.name} (${a.currency}, ${a.timezone_name}): spend ${y} = ${spend.toFixed(2)} ${a.currency} across ${rows.length} ad rows`);
          }
        } catch (e) {
          console.log(`✗ Meta: ${(e as Error).message}`);
        }
      }
    },
  },
  "import-env": {
    help: "import-env                                    Create regions, stores and connections from .env (secrets stored encrypted)",
    async run() {
      const db = getDb();
      const keys = (process.env.SHOPIFY_STORES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const k of keys) {
        const domain = process.env[`SHOPIFY_${k}_DOMAIN`]!;
        const regionCode = (process.env[`SHOPIFY_${k}_REGION`] ?? k).toLowerCase();
        const regionName = process.env[`SHOPIFY_${k}_REGION_NAME`] ?? (regionCode === "bg" ? "Bulgaria" : regionCode.toUpperCase());
        const [region] = await db.insert(regions).values({ code: regionCode, name: regionName }).onConflictDoUpdate({ target: regions.code, set: { name: regionName } }).returning();
        const client = new shopify.ShopifyClient({ shopDomain: domain, clientId: process.env[`SHOPIFY_${k}_CLIENT_ID`]!, clientSecret: process.env[`SHOPIFY_${k}_CLIENT_SECRET`]! });
        const shop = await shopify.fetchShop(client);
        const [store] = await db
          .insert(stores)
          .values({ regionId: region.id, name: process.env[`SHOPIFY_${k}_NAME`] ?? shop.name, shopDomain: shop.myshopifyDomain, currency: shop.currencyCode, timeZone: shop.ianaTimezone, pricesIncludeTax: shop.taxesIncluded })
          .onConflictDoUpdate({ target: stores.shopDomain, set: { currency: shop.currencyCode, timeZone: shop.ianaTimezone, pricesIncludeTax: shop.taxesIncluded } })
          .returning();
        const secretsEnc = encryptSecret(JSON.stringify({ clientId: process.env[`SHOPIFY_${k}_CLIENT_ID`], clientSecret: process.env[`SHOPIFY_${k}_CLIENT_SECRET`] }));
        const existing = await db.select().from(connections).where(and(eq(connections.platform, "shopify"), eq(connections.storeId, store.id)));
        if (existing.length) await db.update(connections).set({ secretsEnc, tokenEnc: null, status: "new" }).where(eq(connections.id, existing[0].id));
        else await db.insert(connections).values({ platform: "shopify", storeId: store.id, label: `Shopify · ${store.name}`, secretsEnc, config: { clientId: process.env[`SHOPIFY_${k}_CLIENT_ID`]! } });
        console.log(`✓ ${store.name} → region ${region.name}`);
      }
      if (process.env.META_SYSTEM_USER_TOKEN) {
        const secretsEnc = encryptSecret(JSON.stringify({ token: process.env.META_SYSTEM_USER_TOKEN }));
        const existing = await db.select().from(connections).where(eq(connections.platform, "meta"));
        if (existing.length) await db.update(connections).set({ secretsEnc, status: "new" }).where(eq(connections.id, existing[0].id));
        else await db.insert(connections).values({ platform: "meta", label: "Meta · System User", secretsEnc });
        console.log("✓ Meta token stored (encrypted). Map ad accounts to stores in Settings.");
      }
    },
  },
  fx: { help: "fx [hist]                                     Load ECB rates (hist = since 1999)", run: async ([w]) => void (await jobs.fxDaily(w === "hist" ? "hist" : "90d")) },
  "shopify-history": { help: "shopify-history [storeId]                     (Re)load order history", run: async ([id]) => jobs.shopifyHistory(id ? Number(id) : undefined) },
  "meta-accounts": { help: "meta-accounts                                 Discover ad accounts", run: async () => void (await jobs.metaAccounts()) },
  "meta-history": { help: "meta-history [adAccountId]                    (Re)load ad history", run: async ([id]) => jobs.metaHistory(id ? Number(id) : undefined) },
  sync: {
    help: "sync <orders|products|sessions|fees|reconcile|meta-today|meta-structure|meta-trailing|renewals|domains>",
    async run([what]) {
      const map: Record<string, () => Promise<unknown>> = {
        orders: jobs.shopifyOrders,
        products: jobs.shopifyProducts,
        sessions: jobs.shopifySessions,
        fees: jobs.shopifyFees,
        reconcile: () => jobs.shopifyReconcile(),
        "meta-today": jobs.metaToday,
        "meta-structure": jobs.metaStructure,
        "meta-trailing": jobs.metaTrailing,
        renewals: jobs.renewals,
        domains: jobs.domains,
      };
      if (!map[what]) throw new Error(`Unknown: ${what}`);
      await map[what]();
      await jobs.metricsRebuild();
    },
  },
  "rebuild-all": {
    help: "rebuild-all                                   Recompute every derived metric",
    async run() {
      const db = getDb();
      await markDirtyRange(db, null, addDays(todayIn("UTC"), -800), addDays(todayIn("UTC"), 1));
      const ads = await db.execute<{ id: number }>(sql`select id from ad_accounts`);
      for (const a of ads.rows) await remapAccount(db, a.id);
      console.log(`Rebuilt ${await jobs.metricsRebuild()} store-days.`);
    },
  },
  backup: { help: "backup                                        Write an encrypted backup now", run: async () => void (await jobs.backup()) },
  restore: {
    help: "restore <file.enc> [--target-db URL]          Decrypt a backup and restore it (default: a new database)",
    async run([file]) {
      if (!file) throw new Error("Usage: restore <file.enc>");
      const plain = file.replace(/\.gz\.enc$/, "").replace(/\.enc$/, "") + ".restore.dump";
      await decryptBackup(file, plain);
      const target = arg("target-db");
      if (!target) {
        console.log(`Decrypted to ${plain}\nRestore into a fresh database, e.g.:\n  createdb ecom_restore\n  pg_restore --no-owner --dbname postgres://…/ecom_restore "${plain}"`);
        return;
      }
      const bin = process.env.PG_BIN_DIR ? `${process.env.PG_BIN_DIR}/pg_restore` : "pg_restore";
      const r = spawnSync(bin, ["--no-owner", "--clean", "--if-exists", "--dbname", target, plain], { stdio: "inherit" });
      if (r.status !== 0) throw new Error("pg_restore failed");
      console.log("Restored.");
    },
  },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const c = commands[cmd ?? ""];
  if (!c) {
    console.log("Usage: pnpm --filter @ecom/worker cli <command>\n\n" + Object.values(commands).map((c) => "  " + c.help).join("\n"));
    process.exit(cmd ? 1 : 0);
  }
  try {
    await c.run(rest.filter((a) => !a.startsWith("--") && !process.argv[process.argv.indexOf(a) - 1]?.startsWith("--")));
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
main();
