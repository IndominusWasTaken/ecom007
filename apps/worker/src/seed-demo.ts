/**
 * DEMO DATA ONLY. Fills an empty database with two synthetic stores (US/USD and
 * Bulgaria/EUR with VAT-inclusive prices), ~150 days of orders, refunds, sessions,
 * Meta ads and expenses, so the dashboard can be previewed before real credentials exist.
 * Everything goes through the same sinks and rebuild as real data.
 *
 * Refuses to run when stores already exist unless --force is passed.
 * Never run against the production database.
 */
import "./env";
import { hash } from "@node-rs/argon2";
import { encryptSecret, generateTotpSecret } from "@ecom/core";
import { addDays, eachDay, todayIn } from "@ecom/core/dates";
import {
  adAccounts,
  appSettings,
  campaignStoreRules,
  chartNotes,
  closeDb,
  expenses,
  fxRates,
  getDb,
  handlingRules,
  markDirtyRange,
  paymentFeeRules,
  regions,
  sessionsDaily,
  shippingRules,
  sql,
  stores,
  subscriptions,
  users,
  variantCosts,
  variants,
  products,
} from "@ecom/db";
import type { meta, shopify } from "@ecom/connectors";
import { shopifySink, recomputeFirstOrders } from "./shopifySink";
import { insightsSink } from "./meta";
import { syncStructureFromFixtures } from "./demoAds";
import { rebuildDirty } from "./rebuild";
import { runRenewals } from "./expenses";
import { ARGON2_OPTS } from "./cliShared";

// deterministic PRNG so the demo looks the same every time
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const poisson = (l: number) => {
  let k = 0;
  let p = 1;
  const L = Math.exp(-l);
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
};

const DAYS = 150;

async function main() {
  const db = getDb();
  const force = process.argv.includes("--force");
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from stores`)).rows;
  if (n > 0 && !force) {
    console.log("Stores already exist; refusing to seed demo data (use --force on a throwaway database).");
    return;
  }
  if (force) {
    await db.execute(sql`truncate regions, stores, orders, order_lines, refunds, refund_lines, transactions, products, variants, sessions_daily,
      ad_accounts, campaigns, ad_sets, ads, creatives, creative_media, ad_insights_daily, daily_ad_metrics, daily_store_metrics, dirty_store_days,
      variant_costs, shipping_rules, handling_rules, payment_fee_rules, subscriptions, subscription_occurrences, expenses, notices, chart_notes,
      connections, campaign_store_rules, fx_rates, sync_runs, sync_cursors restart identity cascade`);
  }

  const today = todayIn("UTC");
  const start = addDays(today, -DAYS);

  // ---------- FX (synthetic around 1.10–1.17 USD per EUR) ----------
  const fxRows = eachDay(addDays(start, -10), today).map((d, i) => ({ date: d, currency: "USD", perEur: (1.135 + 0.025 * Math.sin(i / 17) + 0.004 * Math.sin(i / 3)).toFixed(4) }));
  await db.insert(fxRates).values(fxRows).onConflictDoNothing();

  // ---------- users (demo / demo-password-123, TOTP pre-enrolled and printed) ----------
  const [{ u }] = (await db.execute<{ u: number }>(sql`select count(*)::int u from users`)).rows;
  let totpSecret: string | null = null;
  if (u === 0) {
    totpSecret = generateTotpSecret();
    await db.insert(users).values({
      username: "demo",
      displayName: "Demo",
      passwordHash: await hash("demo-password-123", ARGON2_OPTS),
      totpSecretEnc: encryptSecret(totpSecret),
      totpEnabled: true,
    });
  }

  // ---------- regions & stores ----------
  const [us] = await db.insert(regions).values({ code: "us", name: "US", sortOrder: 1 }).returning();
  const [bg] = await db.insert(regions).values({ code: "bg", name: "Bulgaria", sortOrder: 2 }).returning();
  const [usStore] = await db
    .insert(stores)
    .values({ regionId: us.id, name: "Glow US", shopDomain: "glow-us-demo.myshopify.com", currency: "USD", timeZone: "America/New_York", pricesIncludeTax: false, color: "#4f46e5", historyLoadedAt: new Date(), sessionsStatus: "ok" })
    .returning();
  const [bgStore] = await db
    .insert(stores)
    .values({ regionId: bg.id, name: "Glow BG", shopDomain: "glow-bg-demo.myshopify.com", currency: "EUR", timeZone: "Europe/Sofia", pricesIncludeTax: true, color: "#0ea5e9", historyLoadedAt: new Date(), sessionsStatus: "ok", cogsFallbackPercent: "30" })
    .returning();

  // ---------- catalog ----------
  const catalog = [
    { sku: "SERUM-30", title: "Vitamin C Serum", variant: "30 ml", us: 39, bg: 34.9, cost: 7.2, w: 120 },
    { sku: "SERUM-50", title: "Vitamin C Serum", variant: "50 ml", us: 54, bg: 46.9, cost: 9.8, w: 180 },
    { sku: "CREAM-01", title: "Night Repair Cream", variant: "Default", us: 44, bg: 39.9, cost: 8.5, w: 210 },
    { sku: "MASK-05", title: "Clay Mask 5-pack", variant: "Default", us: 29, bg: 24.9, cost: 4.1, w: 260 },
    { sku: "ROLLER", title: "Jade Face Roller", variant: "Default", us: 24, bg: 19.9, cost: 3.2, w: 150 },
    { sku: "BUNDLE-GLOW", title: "Glow Bundle", variant: "Default", us: 99, bg: 84.9, cost: 18.5, w: 520 },
  ];
  for (const store of [usStore, bgStore]) {
    for (const [i, c] of catalog.entries()) {
      const pid = `gid://shopify/Product/${store.id}${i}`;
      const [p] = await db
        .insert(products)
        .values({ storeId: store.id, shopifyId: pid, title: c.title, status: "ACTIVE", vendor: "Glow" })
        .onConflictDoNothing()
        .returning();
      await db.insert(variants).values({
        storeId: store.id,
        productId: p?.id,
        shopifyId: `gid://shopify/ProductVariant/${store.id}${i}`,
        productShopifyId: pid,
        sku: c.sku,
        title: c.variant,
        price: String(store.currency === "USD" ? c.us : c.bg),
        // Shopify "cost per item" known for some SKUs only
        shopifyCost: i % 2 === 0 ? String(store.currency === "USD" ? c.cost : (c.cost * 0.9).toFixed(2)) : null,
        weightGrams: c.w,
      });
    }
  }
  // typed COGS (USD for both stores; BG converts at the order-date rate), one price change mid-history
  for (const store of [usStore, bgStore]) {
    for (const c of catalog.slice(0, 5)) {
      await db.insert(variantCosts).values({ storeId: store.id, sku: c.sku, cost: String(c.cost), currency: "USD", effectiveFrom: start, source: "typed" });
    }
    await db.insert(variantCosts).values({ storeId: store.id, sku: "SERUM-30", cost: "7.90", currency: "USD", effectiveFrom: addDays(today, -40), source: "typed" });
  }
  // BUNDLE-GLOW has no typed cost: US falls back to Shopify cost; BG uses the 30% fallback

  // ---------- cost rules ----------
  await db.insert(shippingRules).values([
    { storeId: usStore.id, mode: "flat", flatAmount: "6.50", currency: "USD", effectiveFrom: start },
    {
      storeId: bgStore.id,
      mode: "table",
      flatAmount: "4.20",
      currency: "EUR",
      effectiveFrom: start,
      table: [
        { country: "BG", basis: "items", min: 1, max: 2, amount: "3.40" },
        { country: "BG", basis: "items", min: 3, max: null, amount: "4.60" },
        { country: "*", basis: "items", min: 1, max: null, amount: "9.80" },
      ],
    },
  ]);
  await db.insert(handlingRules).values([
    { storeId: usStore.id, perOrder: "1.20", perItem: "0.35", currency: "USD", effectiveFrom: start },
    { storeId: bgStore.id, perOrder: "0.90", perItem: "0.25", currency: "EUR", effectiveFrom: start },
  ]);
  await db.insert(paymentFeeRules).values([
    { storeId: usStore.id, gateway: "shopify_payments", percent: "2.9", fixed: "0.30", currency: "USD", effectiveFrom: start },
    { storeId: bgStore.id, gateway: "shopify_payments", percent: "1.9", fixed: "0.25", currency: "EUR", effectiveFrom: start },
    { storeId: bgStore.id, gateway: "Cash on Delivery (COD)", percent: "0", fixed: "1.50", currency: "EUR", effectiveFrom: start },
  ]);

  // ---------- orders ----------
  for (const store of [usStore, bgStore]) {
    const isUs = store.currency === "USD";
    const sink = shopifySink(store);
    const customers: string[] = [];
    let num = 1000;
    const batch: shopify.OrderRecord[] = [];
    for (const [di, d] of eachDay(start, today).entries()) {
      const growth = 0.4 + (di / DAYS) * 1.1;
      const weekday = new Date(d + "T12:00:00Z").getUTCDay();
      const lambda = (isUs ? 9 : 6) * growth * (weekday === 0 || weekday === 6 ? 1.2 : 1);
      const count = poisson(lambda);
      const sessions = Math.round(count * (isUs ? 48 : 38) * (0.85 + rnd() * 0.3)) + 20;
      await db.insert(sessionsDaily).values({
        storeId: store.id,
        date: d,
        sessions,
        addedToCart: Math.round(sessions * (0.07 + rnd() * 0.02)),
        reachedCheckout: Math.round(sessions * (0.035 + rnd() * 0.01)),
        completedCheckout: count,
      });
      for (let k = 0; k < count; k++) {
        num++;
        const hour = 8 + Math.floor(rnd() * 14);
        const created = new Date(`${d}T${String(hour).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`);
        const returning = customers.length > 10 && rnd() < 0.22;
        const customerId = returning ? pick(customers) : `gid://shopify/Customer/${store.id}${num}`;
        if (!returning) customers.push(customerId);
        const nLines = rnd() < 0.7 ? 1 : 2;
        const lines: shopify.LineRecord[] = [];
        const used = new Set<number>();
        for (let li = 0; li < nLines; li++) {
          let idx = Math.floor(rnd() * catalog.length);
          while (used.has(idx)) idx = (idx + 1) % catalog.length;
          used.add(idx);
          const c = catalog[idx];
          const qty = rnd() < 0.85 ? 1 : 2;
          const price = isUs ? c.us : c.bg;
          const discount = rnd() < 0.25 ? +(price * qty * 0.15).toFixed(2) : 0;
          const net = price * qty - discount;
          const tax = isUs ? +(net * 0.07 * (rnd() < 0.6 ? 1 : 0)).toFixed(2) : +((net / 1.2) * 0.2).toFixed(2);
          lines.push({
            shopifyId: `gid://shopify/LineItem/${store.id}${num}${li}`,
            productShopifyId: `gid://shopify/Product/${store.id}${idx}`,
            variantShopifyId: `gid://shopify/ProductVariant/${store.id}${idx}`,
            sku: c.sku,
            title: c.title,
            variantTitle: c.variant,
            quantity: qty,
            unitPrice: price.toFixed(2),
            discount: discount.toFixed(2),
            tax: tax.toFixed(2),
            requiresShipping: true,
            raw: {},
          });
        }
        const subtotal = lines.reduce((a, l) => a + Number(l.unitPrice) * l.quantity - Number(l.discount), 0);
        const freeShip = isUs ? subtotal >= 60 : subtotal >= 50;
        const shipping = freeShip ? 0 : isUs ? 5.95 : 4.99;
        const shipTax = isUs ? 0 : +((shipping / 1.2) * 0.2).toFixed(2);
        const lineTax = lines.reduce((a, l) => a + Number(l.tax), 0);
        const totalTax = lineTax + shipTax;
        const total = isUs ? subtotal + shipping + totalTax : subtotal + shipping;
        const cod = !isUs && rnd() < 0.35;
        const fulfilled = d < addDays(today, -2) || rnd() < 0.5;
        const refunds: shopify.RefundRecord[] = [];
        const roll = rnd();
        if (d < addDays(today, -3) && roll < 0.06) {
          // full or partial refund a few days later
          const full = roll < 0.025;
          const rDate = new Date(created.getTime() + (2 + Math.floor(rnd() * 8)) * 86_400_000);
          if (rDate < new Date()) {
            const rl = full ? lines : [lines[0]];
            const restock = rnd() < 0.5;
            const rlines = rl.map((l) => ({
              shopifyId: `${l.shopifyId}-r`,
              orderLineShopifyId: l.shopifyId,
              quantity: l.quantity,
              subtotal: (Number(l.unitPrice) * l.quantity - Number(l.discount)).toFixed(2),
              tax: l.tax,
              restockType: restock ? "RETURN" : "NO_RESTOCK",
              restocked: restock,
            }));
            const amount = rlines.reduce((a, l) => a + Number(l.subtotal) + (isUs ? Number(l.tax) : 0), 0) + (full ? shipping + (isUs ? 0 : 0) : 0);
            refunds.push({
              shopifyId: `gid://shopify/Refund/${store.id}${num}`,
              createdAt: rDate.toISOString(),
              note: full ? "Customer return" : "Damaged item",
              totalRefunded: amount.toFixed(2),
              shippingAmount: full ? (shipping - shipTax).toFixed(2) : "0",
              shippingTax: full ? shipTax.toFixed(2) : "0",
              otherAmount: "0",
              lines: rlines,
              raw: {},
            });
          }
        }
        batch.push({
          shopifyId: `gid://shopify/Order/${store.id}${num}`,
          name: `#${num}`,
          createdAt: created.toISOString(),
          updatedAt: created.toISOString(),
          cancelledAt: null,
          test: k === 0 && di === 5,
          currency: store.currency,
          presentmentCurrency: store.currency,
          taxesIncluded: !isUs,
          sourceName: "web",
          channel: rnd() < 0.9 ? "Online Store" : "Shop",
          customerId,
          customerOrderIndex: null,
          shippingCountry: isUs ? "US" : rnd() < 0.93 ? "BG" : "RO",
          requiresShipping: true,
          totalWeightGrams: 300,
          financialStatus: refunds.length ? "PARTIALLY_REFUNDED" : "PAID",
          fulfillmentStatus: fulfilled ? "FULFILLED" : "UNFULFILLED",
          fulfilledAt: fulfilled ? new Date(created.getTime() + 86_400_000 * (1 + Math.floor(rnd() * 2))).toISOString() : null,
          subtotal: subtotal.toFixed(2),
          totalDiscounts: lines.reduce((a, l) => a + Number(l.discount), 0).toFixed(2),
          shippingAmount: shipping.toFixed(2),
          shippingTax: shipTax.toFixed(2),
          totalTax: totalTax.toFixed(2),
          totalPrice: total.toFixed(2),
          utm: { source: rnd() < 0.7 ? "facebook" : "google", medium: "paid", campaign: null, content: null, term: null },
          landingPage: null,
          lines,
          transactions: [
            {
              shopifyId: `gid://shopify/OrderTransaction/${store.id}${num}`,
              kind: "SALE",
              status: "SUCCESS",
              gateway: cod ? "Cash on Delivery (COD)" : "shopify_payments",
              amount: total.toFixed(2),
              currency: store.currency,
              processedAt: created.toISOString(),
              test: false,
            },
          ],
          refunds,
          linesTruncated: false,
          raw: {},
        });
        if (batch.length >= 200) await sink.orders(batch.splice(0));
      }
    }
    if (batch.length) await sink.orders(batch.splice(0));
    await recomputeFirstOrders(db, store.id);
  }

  // ---------- Meta ads ----------
  const [acctA] = await db
    .insert(adAccounts)
    .values({ platform: "meta", externalId: "act_1000000001", name: "Glow – Testing A", currency: "USD", timeZone: "America/New_York", storeId: usStore.id, historyLoadedAt: new Date() })
    .returning();
  const [acctB] = await db
    .insert(adAccounts)
    .values({ platform: "meta", externalId: "act_1000000002", name: "Glow – Testing B", currency: "EUR", timeZone: "Europe/Sofia", storeId: null, historyLoadedAt: new Date() })
    .returning();
  // account B: "BG" campaigns go to the BG store, anything else stays Unassigned
  await db.insert(campaignStoreRules).values({ adAccountId: acctB.id, pattern: "BG", storeId: bgStore.id, priority: 10 });
  const { insights } = await syncStructureFromFixtures(db, [acctA, acctB], start, today, rnd);
  for (const [act, rows] of insights) await insightsSink(db).insights(act, rows as meta.InsightRow[]);

  // ---------- expenses ----------
  await db.insert(subscriptions).values([
    { name: "Shopify Basic", vendor: "Shopify", category: "shopify_plan", amount: "39", currency: "USD", cycle: "monthly", anchorDate: addDays(start, 3), scope: "store", storeId: usStore.id, paymentMethod: "Revolut •• 4421", manageUrl: "https://admin.shopify.com" },
    { name: "Shopify Basic BG", vendor: "Shopify", category: "shopify_plan", amount: "36", currency: "EUR", cycle: "monthly", anchorDate: addDays(start, 9), scope: "store", storeId: bgStore.id, paymentMethod: "Revolut •• 4421" },
    { name: "Claude Max", vendor: "Anthropic", category: "tools", amount: "100", currency: "USD", cycle: "monthly", anchorDate: addDays(today, 1), scope: "shared", paymentMethod: "Wise •• 0912", notes: "Used by both stores" },
    { name: "Review app", vendor: "Judge.me", category: "apps", amount: "15", currency: "USD", cycle: "monthly", anchorDate: addDays(start, 20), scope: "shared", allocation: "revenue" },
    { name: "glow-demo.com", vendor: "Namecheap", category: "domains", amount: "14.98", currency: "USD", cycle: "yearly", anchorDate: addDays(today, 5), scope: "store", storeId: usStore.id, domain: "glow-demo.com" },
    { name: "UGC creator retainer", vendor: "Maria K.", category: "contractors", amount: "400", currency: "EUR", cycle: "monthly", anchorDate: addDays(start, 14), scope: "region", regionId: bg.id, countsAsAdSpend: true },
  ]);
  await db.insert(expenses).values([
    { date: addDays(today, -60), name: "Product photoshoot", category: "other", amount: "650", currency: "EUR", scope: "shared" },
    { date: addDays(today, -21), name: "Sample batch", category: "other", amount: "180", currency: "USD", scope: "store", storeId: usStore.id },
  ]);
  await db.insert(chartNotes).values([
    { date: addDays(today, -40), text: "New serum price + cost" },
    { date: addDays(today, -15), text: "Bundle offer launched" },
  ]);
  await db.insert(appSettings).values({ key: "profit_tax_rate", value: 0 }).onConflictDoNothing();

  await runRenewals(db, today);
  await markDirtyRange(db, null, addDays(start, -1), addDays(today, 1));
  let rebuilt = 0;
  for (;;) {
    const r = await rebuildDirty(db);
    rebuilt += r;
    if (!r) break;
  }
  console.log(`Demo data ready: ${rebuilt} store-days rebuilt.`);
  if (totpSecret) console.log(`Login: demo / demo-password-123  ·  TOTP secret (add to an authenticator app): ${totpSecret}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

