"use server";
import { revalidatePath } from "next/cache";
import { addDays } from "@ecom/core/dates";
import { parseCsv } from "@ecom/core/csv";
import {
  audit,
  eq,
  getDb,
  handlingRules,
  loadFx,
  markDirty,
  markDirtyRange,
  paymentFeeRules,
  shippingRules,
  sql,
  stores,
  variantCosts,
  type Db,
} from "@ecom/db";
import { requireUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ActionForm";
import { amount, dirtyWindow, historyStart, isDate, knownCurrency, str, today } from "@/lib/forms";

/*
 * Every cost is a dated row: a change is a new row with a later effective_from, so history
 * (and therefore past profit) is never rewritten. After each change the affected store-days
 * are marked dirty and the worker rebuilds them within a minute.
 */

const MAX_UPLOAD = 2 * 1024 * 1024;

async function markFrom(db: Db, storeId: number, from: string) {
  const w = await dirtyWindow(db, from, storeId);
  if (w) await markDirtyRange(db, storeId, w.from, w.to);
}

/** The rule in force on `date` before this change, for the edit log's "old" column. */
async function ruleInForce(db: Db, table: "shipping_rules" | "handling_rules" | "payment_fee_rules", storeId: number, date: string, gateway?: string) {
  const res = await db.execute(sql`select * from ${sql.identifier(table)} where store_id = ${storeId} and effective_from <= ${date}
    ${gateway === undefined ? sql`` : sql`and gateway = ${gateway}`} order by effective_from desc, id desc limit 1`);
  return res.rows[0] ?? null;
}

async function storeById(db: Db, id: number) {
  const [s] = await db.select().from(stores).where(eq(stores.id, id));
  return s ?? null;
}

function done(message: string): ActionResult {
  revalidatePath("/costs");
  return { ok: true, message };
}

const fail = (message: string, errors?: string[]): ActionResult => ({ ok: false, message, errors });

/** Accept a store id, its name, its myshopify domain or (when unambiguous) its region code. */
async function storeResolver(db: Db) {
  const res = await db.execute<{ id: number; name: string; shop_domain: string; currency: string; code: string }>(
    sql`select s.id, s.name, s.shop_domain, s.currency, r.code from stores s join regions r on r.id = s.region_id`,
  );
  return (key: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return null;
    const byId = res.rows.find((s) => String(s.id) === k);
    if (byId) return byId;
    const exact = res.rows.find((s) => s.name.toLowerCase() === k || s.shop_domain.toLowerCase() === k || s.shop_domain.toLowerCase() === `${k}.myshopify.com`);
    if (exact) return exact;
    const inRegion = res.rows.filter((s) => s.code.toLowerCase() === k);
    return inRegion.length === 1 ? inRegion[0] : null;
  };
}

async function readUpload(form: FormData): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "Choose a CSV file first." };
  if (f.size > MAX_UPLOAD) return { error: "The file is larger than 2 MB. Split it into smaller files." };
  return { rows: parseCsv(await f.text()) };
}

// ---------------------------------------------------------------- COGS

export async function createVariantCost(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const storeId = Number(str(form, "storeId"));
  const sku = str(form, "sku") || null;
  const variantShopifyId = str(form, "variantShopifyId") || null;
  const cost = amount(str(form, "cost"));
  const currency = str(form, "currency").toUpperCase();
  const effectiveFrom = str(form, "effectiveFrom") || today();
  if (!(await storeById(db, storeId))) return fail("Unknown store.");
  if (!sku && !variantShopifyId) return fail("A SKU or variant is required.");
  if (cost === null) return fail("Enter the cost as a number, e.g. 7.20.");
  if (!knownCurrency(await loadFx(db), currency)) return fail(`No exchange rate for ${currency || "that currency"} yet.`);
  if (!isDate(effectiveFrom)) return fail("Effective-from must be a date.");

  // the row this one supersedes, for the edit log
  const prev = await db.execute(sql`select id, cost::text, currency, effective_from::text, source from variant_costs
    where store_id = ${storeId} and effective_from <= ${effectiveFrom}
      and (variant_shopify_id = ${variantShopifyId ?? ""} or lower(sku) = lower(${sku ?? ""}))
    order by effective_from desc, id desc limit 1`);
  const [row] = await db.insert(variantCosts).values({ storeId, sku, variantShopifyId, cost, currency, effectiveFrom, source: "typed", createdBy: user.id }).returning();
  await audit(db, { userId: user.id, action: "cost.variant.create", entity: "variant_cost", entityId: row.id, oldValue: prev.rows[0] ?? null, newValue: row });
  await markFrom(db, storeId, effectiveFrom);
  return done(`Saved ${cost} ${currency} for ${sku ?? "variant"} from ${effectiveFrom}.`);
}

/** Copy Shopify's "cost per item" into typed rows where nothing is typed yet. Never overwrites. */
export async function prefillFromShopify(_: ActionResult, _form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const candidates = await db.execute<{ store_id: number; shopify_id: string; sku: string | null; shopify_cost: string; currency: string }>(sql`
    select v.store_id, v.shopify_id, v.sku, v.shopify_cost::text, s.currency
    from variants v join stores s on s.id = v.store_id
    where v.shopify_cost > 0 and not exists (
      select 1 from variant_costs c where c.store_id = v.store_id
        and (c.variant_shopify_id = v.shopify_id or (v.sku is not null and lower(c.sku) = lower(v.sku))))`);
  if (!candidates.rows.length) return { ok: true, message: "Nothing to prefill: every variant with a Shopify cost already has a typed cost." };
  const starts = new Map<number, string>();
  for (const c of candidates.rows) if (!starts.has(c.store_id)) starts.set(c.store_id, await historyStart(db, c.store_id));
  const values = candidates.rows.map((c) => ({
    storeId: c.store_id,
    sku: c.sku,
    variantShopifyId: c.shopify_id,
    cost: c.shopify_cost,
    currency: c.currency,
    effectiveFrom: starts.get(c.store_id) ?? addDays(today(), -730),
    source: "prefill",
    createdBy: user.id,
  }));
  const rows = await db.insert(variantCosts).values(values).returning();
  await audit(db, { userId: user.id, action: "cost.variant.prefill", entity: "variant_cost", newValue: { count: rows.length, ids: rows.map((r) => r.id) } });
  for (const [storeId, from] of starts) await markFrom(db, storeId, from);
  return done(`Prefilled ${rows.length} variant cost${rows.length === 1 ? "" : "s"} from Shopify.`);
}

/** CSV: store, sku, cost, currency, effective_from. Valid lines are imported, the rest reported. */
export async function importCostsCsv(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const up = await readUpload(form);
  if ("error" in up) return fail(up.error);
  if (!up.rows.length) return fail("The file has no data rows.");
  const missingCols = ["store", "sku", "cost"].filter((c) => !(c in up.rows[0]));
  if (missingCols.length) return fail(`Missing column(s): ${missingCols.join(", ")}. Expected store, sku, cost, currency, effective_from.`);

  const resolve = await storeResolver(db);
  const fx = await loadFx(db);
  const known = await db.execute<{ store_id: number; sku: string }>(sql`
    select store_id, lower(sku) sku from variants where sku is not null
    union select store_id, lower(sku) from order_lines where sku is not null`);
  const skuSet = new Set(known.rows.map((r) => `${r.store_id}:${r.sku}`));
  const variantBySku = await db.execute<{ store_id: number; sku: string; shopify_id: string }>(sql`select store_id, lower(sku) sku, shopify_id from variants where sku is not null`);
  const vid = new Map(variantBySku.rows.map((r) => [`${r.store_id}:${r.sku}`, r.shopify_id]));

  const errors: string[] = [];
  const values: (typeof variantCosts.$inferInsert)[] = [];
  up.rows.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const store = resolve(r.store ?? "");
    const sku = (r.sku ?? "").trim();
    const cost = amount(r.cost ?? "");
    const currency = (r.currency || store?.currency || "").toUpperCase();
    const from = r.effective_from || today();
    if (!store) return errors.push(`Line ${line}: unknown store "${r.store ?? ""}"`);
    if (!sku) return errors.push(`Line ${line}: SKU is empty`);
    if (!skuSet.has(`${store.id}:${sku.toLowerCase()}`)) return errors.push(`Line ${line}: SKU "${sku}" not found in ${store.name}`);
    if (cost === null) return errors.push(`Line ${line}: cost "${r.cost ?? ""}" is not a number`);
    if (!knownCurrency(fx, currency)) return errors.push(`Line ${line}: no exchange rate for currency "${currency}"`);
    if (!isDate(from)) return errors.push(`Line ${line}: effective_from "${from}" is not a YYYY-MM-DD date`);
    values.push({ storeId: store.id, sku, variantShopifyId: vid.get(`${store.id}:${sku.toLowerCase()}`) ?? null, cost, currency, effectiveFrom: from, source: "csv", createdBy: user.id });
  });
  if (values.length) {
    const rows = await db.insert(variantCosts).values(values).returning();
    await audit(db, { userId: user.id, action: "cost.variant.import", entity: "variant_cost", newValue: { count: rows.length, ids: rows.map((r) => r.id), errors: errors.length } });
    const earliest = new Map<number, string>();
    for (const v of values) if (!earliest.has(v.storeId) || v.effectiveFrom < earliest.get(v.storeId)!) earliest.set(v.storeId, v.effectiveFrom);
    for (const [storeId, from] of earliest) await markFrom(db, storeId, from);
    revalidatePath("/costs");
  }
  return { ok: errors.length === 0, message: `Imported ${values.length} cost${values.length === 1 ? "" : "s"}${errors.length ? `, ${errors.length} line(s) with errors` : ""}.`, errors };
}

export async function setFallback(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const storeId = Number(str(form, "storeId"));
  const store = await storeById(db, storeId);
  if (!store) return fail("Unknown store.");
  const raw = str(form, "percent");
  const pct = raw === "" ? null : amount(raw);
  if (raw !== "" && (pct === null || Number(pct) > 100)) return fail("Enter a percentage between 0 and 100, or leave empty to turn it off.");
  await db.update(stores).set({ cogsFallbackPercent: pct, updatedAt: new Date() }).where(eq(stores.id, storeId));
  await audit(db, { userId: user.id, action: "cost.fallback.update", entity: "store", entityId: storeId, oldValue: { cogsFallbackPercent: store.cogsFallbackPercent }, newValue: { cogsFallbackPercent: pct } });
  // the fallback applies to every past line without a cost, so rebuild the whole history
  await markFrom(db, storeId, "1970-01-01");
  return done(pct === null ? `Fallback turned off for ${store.name}.` : `Fallback for ${store.name} set to ${pct}% of price.`);
}

// ---------------------------------------------------------------- shipping, handling, fees

type TableRow = { country: string; basis: "weight" | "items"; min: number; max: number | null; amount: string };

function parseTable(json: string): { rows: TableRow[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json || "[]");
  } catch {
    return { error: "The rate table could not be read." };
  }
  if (!Array.isArray(data)) return { error: "The rate table could not be read." };
  const rows: TableRow[] = [];
  for (const [i, r] of data.entries()) {
    const country = String(r.country ?? "").trim().toUpperCase() || "*";
    const basis = r.basis === "items" ? "items" : "weight";
    const min = Number(r.min || 0);
    const max = r.max === "" || r.max === null || r.max === undefined ? null : Number(r.max);
    const amt = amount(String(r.amount ?? ""));
    if (country !== "*" && !/^[A-Z]{2}$/.test(country)) return { error: `Row ${i + 1}: country must be a 2-letter code or *` };
    if (!Number.isFinite(min) || min < 0 || (max !== null && (!Number.isFinite(max) || max < min))) return { error: `Row ${i + 1}: check min/max` };
    if (amt === null) return { error: `Row ${i + 1}: amount must be a number` };
    rows.push({ country, basis, min, max, amount: amt });
  }
  return { rows };
}

export async function createShippingRule(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const storeId = Number(str(form, "storeId"));
  const store = await storeById(db, storeId);
  const mode = str(form, "mode");
  const flatAmount = amount(str(form, "flatAmount") || "0");
  const currency = str(form, "currency").toUpperCase();
  const effectiveFrom = str(form, "effectiveFrom") || today();
  if (!store) return fail("Unknown store.");
  if (!["flat", "table", "actual"].includes(mode)) return fail("Choose a mode.");
  if (flatAmount === null) return fail("Flat amount must be a number.");
  if (!knownCurrency(await loadFx(db), currency)) return fail(`No exchange rate for ${currency} yet.`);
  if (!isDate(effectiveFrom)) return fail("Effective-from must be a date.");
  let table: TableRow[] | null = null;
  if (mode === "table") {
    const t = parseTable(str(form, "table"));
    if ("error" in t) return fail(t.error);
    if (!t.rows.length) return fail("Add at least one table row (or use flat mode).");
    table = t.rows;
  }
  const prev = await ruleInForce(db, "shipping_rules", storeId, effectiveFrom);
  const [row] = await db.insert(shippingRules).values({ storeId, mode, flatAmount, currency, table, effectiveFrom, createdBy: user.id }).returning();
  await audit(db, { userId: user.id, action: "cost.shipping.create", entity: "shipping_rule", entityId: row.id, oldValue: prev, newValue: row });
  await markFrom(db, storeId, effectiveFrom);
  return done(`Shipping rule for ${store.name} saved, in force from ${effectiveFrom}.`);
}

/** Carrier CSV: order_name, cost, currency, carrier. Upserts per store + order name; actuals beat every rule. */
export async function importShippingActuals(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const storeId = Number(str(form, "storeId"));
  const store = await storeById(db, storeId);
  if (!store) return fail("Choose the store these shipments belong to.");
  const up = await readUpload(form);
  if ("error" in up) return fail(up.error);
  if (!up.rows.length) return fail("The file has no data rows.");
  if (!("order_name" in up.rows[0]) || !("cost" in up.rows[0])) return fail("Missing column(s). Expected order_name, cost, currency, carrier.");
  const fx = await loadFx(db);
  const errors: string[] = [];
  const valid: { orderName: string; cost: string; currency: string; carrier: string | null }[] = [];
  up.rows.forEach((r, i) => {
    const line = i + 2;
    const raw = (r.order_name ?? "").trim();
    const orderName = raw && !raw.startsWith("#") ? `#${raw}` : raw;
    const cost = amount(r.cost ?? "");
    const currency = (r.currency || store.currency).toUpperCase();
    if (!orderName) return errors.push(`Line ${line}: order_name is empty`);
    if (cost === null) return errors.push(`Line ${line}: cost "${r.cost ?? ""}" is not a number`);
    if (!knownCurrency(fx, currency)) return errors.push(`Line ${line}: no exchange rate for currency "${currency}"`);
    valid.push({ orderName, cost, currency, carrier: (r.carrier ?? "").slice(0, 64) || null });
  });
  // last line wins when the same order appears twice in one file
  const byName = new Map(valid.map((v) => [v.orderName, v]));
  const list = [...byName.values()];
  if (list.length) {
    await db.execute(sql`
      insert into order_shipping_costs (store_id, order_name, cost, currency, carrier)
      select ${storeId}, v.n, v.c::numeric, v.ccy, nullif(v.car, '')
      from unnest(${sql.param(list.map((v) => v.orderName))}::text[], ${sql.param(list.map((v) => v.cost))}::text[],
                  ${sql.param(list.map((v) => v.currency))}::text[], ${sql.param(list.map((v) => v.carrier ?? ""))}::text[]) as v(n, c, ccy, car)
      on conflict (store_id, order_name) do update set cost = excluded.cost, currency = excluded.currency, carrier = excluded.carrier, created_at = now()`);
    const dates = await db.execute<{ d: string; name: string }>(sql`
      select local_date::text d, name from orders where store_id = ${storeId} and name = any(${sql.param(list.map((v) => v.orderName))}::text[])`);
    await markDirty(db, storeId, dates.rows.map((r) => r.d));
    const found = new Set(dates.rows.map((r) => r.name));
    const unmatched = list.filter((v) => !found.has(v.orderName)).length;
    if (unmatched) errors.push(`${unmatched} order name(s) not found in ${store.name} yet; they are stored and apply once the order syncs.`);
    await audit(db, { userId: user.id, action: "cost.shipping_actual.import", entity: "order_shipping_cost", entityId: storeId, newValue: { count: list.length, unmatched } });
    revalidatePath("/costs");
  }
  return { ok: list.length > 0, message: `Imported ${list.length} shipping cost${list.length === 1 ? "" : "s"} for ${store.name}.`, errors };
}

export async function createHandlingRule(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const storeId = Number(str(form, "storeId"));
  const store = await storeById(db, storeId);
  const perOrder = amount(str(form, "perOrder") || "0");
  const perItem = amount(str(form, "perItem") || "0");
  const currency = str(form, "currency").toUpperCase();
  const effectiveFrom = str(form, "effectiveFrom") || today();
  if (!store) return fail("Unknown store.");
  if (perOrder === null || perItem === null) return fail("Fees must be numbers.");
  if (!knownCurrency(await loadFx(db), currency)) return fail(`No exchange rate for ${currency} yet.`);
  if (!isDate(effectiveFrom)) return fail("Effective-from must be a date.");
  const prev = await ruleInForce(db, "handling_rules", storeId, effectiveFrom);
  const [row] = await db.insert(handlingRules).values({ storeId, perOrder, perItem, currency, effectiveFrom, createdBy: user.id }).returning();
  await audit(db, { userId: user.id, action: "cost.handling.create", entity: "handling_rule", entityId: row.id, oldValue: prev, newValue: row });
  await markFrom(db, storeId, effectiveFrom);
  return done(`Handling fees for ${store.name} saved, in force from ${effectiveFrom}.`);
}

export async function createPaymentFeeRule(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const storeId = Number(str(form, "storeId"));
  const store = await storeById(db, storeId);
  const gateway = str(form, "gateway") || "*";
  const percent = amount(str(form, "percent") || "0");
  const fixed = amount(str(form, "fixed") || "0");
  const currency = str(form, "currency").toUpperCase();
  const effectiveFrom = str(form, "effectiveFrom") || today();
  if (!store) return fail("Unknown store.");
  if (percent === null || Number(percent) > 100) return fail("Percent must be between 0 and 100.");
  if (fixed === null) return fail("Fixed fee must be a number.");
  if (!knownCurrency(await loadFx(db), currency)) return fail(`No exchange rate for ${currency} yet.`);
  if (!isDate(effectiveFrom)) return fail("Effective-from must be a date.");
  const prev = await ruleInForce(db, "payment_fee_rules", storeId, effectiveFrom, gateway.slice(0, 128));
  const [row] = await db.insert(paymentFeeRules).values({ storeId, gateway: gateway.slice(0, 128), percent, fixed, currency, effectiveFrom, createdBy: user.id }).returning();
  await audit(db, { userId: user.id, action: "cost.payment_fee.create", entity: "payment_fee_rule", entityId: row.id, oldValue: prev, newValue: row });
  await markFrom(db, storeId, effectiveFrom);
  return done(`Payment fee rule for ${gateway === "*" ? "any other gateway" : gateway} saved.`);
}
