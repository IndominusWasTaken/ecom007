"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { parseCsv } from "@ecom/core/csv";
import { randomToken, sha256 } from "@ecom/core/crypto";
import { chargeDates, type BillingCycle } from "@ecom/core/recurrence";
import {
  audit,
  calendarTokens,
  eq,
  expenses,
  getDb,
  listStoresAndRegions,
  loadFx,
  markDirtyRange,
  subscriptionOccurrences,
  subscriptions,
  type Db,
} from "@ecom/db";
import { requireUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ActionForm";
import { amount, dirtyWindow, isDate, knownCurrency, str, today } from "@/lib/forms";
import { CATEGORIES, CYCLES, STATUSES } from "./constants";

/*
 * Expenses hit metrics as cash: the full amount lands on each charge date and is allocated
 * across stores by scope (see apps/worker/src/rebuild.ts). Any change re-dirties every
 * store-day it can touch, from the earliest affected date to today.
 */

type Sub = typeof subscriptions.$inferSelect;
const fail = (message: string, errors?: string[]): ActionResult => ({ ok: false, message, errors });

function done(message: string): ActionResult {
  revalidatePath("/expenses");
  return { ok: true, message };
}

/** Rebuild all stores from `from` (clamped to history start) to today. */
async function markAll(db: Db, from: string) {
  const w = await dirtyWindow(db, from);
  if (w) await markDirtyRange(db, null, w.from, w.to);
}

/** First date a subscription can have charged: one-offs on their date, recurring from start (or forever back). */
const earliestCharge = (s: Pick<Sub, "cycle" | "anchorDate" | "startDate">) => (s.cycle === "one_off" ? s.anchorDate : (s.startDate ?? "1970-01-01"));

const spec = (s: Pick<Sub, "cycle" | "everyNMonths" | "anchorDate" | "startDate" | "endDate">) => ({
  cycle: s.cycle as BillingCycle,
  everyNMonths: s.everyNMonths,
  anchorDate: s.anchorDate,
  startDate: s.startDate,
  endDate: s.endDate,
});

type Scope = { scope: string; storeId: number | null; regionId: number | null; allocation: string; allocationPercents: Record<string, number> | null };

/** Scope + allocation fields shared by the subscription and expense forms. */
async function parseScope(db: Db, form: FormData): Promise<Scope | { error: string }> {
  const sr = await listStoresAndRegions(db);
  const scope = str(form, "scope") || "shared";
  const allocation = str(form, "allocation") || "equal";
  if (!["store", "region", "shared"].includes(scope)) return { error: "Choose a scope." };
  if (!["equal", "fixed", "revenue"].includes(allocation)) return { error: "Choose an allocation." };
  let storeId: number | null = null;
  let regionId: number | null = null;
  if (scope === "store") {
    storeId = Number(str(form, "storeId"));
    if (!sr.some((r) => r.store_id === storeId)) return { error: "Choose the store." };
  }
  if (scope === "region") {
    regionId = Number(str(form, "regionId"));
    if (!sr.some((r) => r.region_id === regionId)) return { error: "Choose the region." };
  }
  let allocationPercents: Record<string, number> | null = null;
  if (allocation === "fixed" && scope !== "store") {
    allocationPercents = {};
    for (const r of sr) {
      if (scope === "region" && r.region_id !== regionId) continue;
      const v = str(form, `pct_${r.store_id}`);
      if (v === "") continue;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return { error: `Percent for ${r.store_name} must be a number.` };
      allocationPercents[String(r.store_id)] = n;
    }
    const total = Object.values(allocationPercents).reduce((a, b) => a + b, 0);
    if (total <= 0) return { error: "Enter the fixed percentages per store." };
  }
  return { scope, storeId, regionId, allocation: scope === "store" ? "equal" : allocation, allocationPercents };
}

// ---------------------------------------------------------------- subscriptions

export async function saveSubscription(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const id = Number(str(form, "id")) || null;
  const name = str(form, "name").slice(0, 128);
  const amt = amount(str(form, "amount"));
  const currency = str(form, "currency").toUpperCase();
  const cycle = str(form, "cycle");
  const everyNMonths = cycle === "every_n_months" ? Number(str(form, "everyNMonths")) : null;
  const anchorDate = str(form, "anchorDate");
  const startDate = str(form, "startDate") || null;
  const endDate = str(form, "endDate") || null;
  const status = str(form, "status") || "active";
  const category = str(form, "category") || "tools";
  const reminderRaw = str(form, "reminderDays");
  const domainExpiry = str(form, "domainExpiry") || null;

  if (!name) return fail("Name is required.");
  if (amt === null) return fail("Amount must be a number.");
  if (!knownCurrency(await loadFx(db), currency)) return fail(`No exchange rate for ${currency} yet.`);
  if (!CYCLES.some((c) => c.value === cycle)) return fail("Choose a billing cycle.");
  if (cycle === "every_n_months" && (!Number.isInteger(everyNMonths) || everyNMonths! < 1 || everyNMonths! > 120)) return fail("“Every N months” needs N between 1 and 120.");
  if (!isDate(anchorDate)) return fail("Charge date (anchor) is required.");
  if ((startDate && !isDate(startDate)) || (endDate && !isDate(endDate)) || (domainExpiry && !isDate(domainExpiry))) return fail("Check the dates.");
  if (startDate && endDate && endDate < startDate) return fail("End date is before start date.");
  if (!STATUSES.some((s) => s.value === status)) return fail("Choose a status.");
  if (!CATEGORIES.some((c) => c.value === category)) return fail("Choose a category.");
  if (reminderRaw && !/^\d{1,3}$/.test(reminderRaw)) return fail("Reminder days must be a whole number.");
  const scope = await parseScope(db, form);
  if ("error" in scope) return fail(scope.error);

  const values = {
    name,
    vendor: str(form, "vendor").slice(0, 128) || null,
    category,
    amount: amt,
    currency,
    cycle,
    everyNMonths,
    anchorDate,
    startDate,
    endDate: status === "cancelled" ? (endDate ?? today()) : endDate,
    ...scope,
    status,
    paymentMethod: str(form, "paymentMethod").slice(0, 128) || null,
    manageUrl: str(form, "manageUrl") || null,
    notes: str(form, "notes") || null,
    countsAsAdSpend: form.get("countsAsAdSpend") === "on",
    reminderDays: reminderRaw ? Number(reminderRaw) : null,
    domain: str(form, "domain").toLowerCase().slice(0, 255) || null,
    domainExpiry,
  };

  if (!id) {
    const [row] = await db.insert(subscriptions).values({ ...values, createdBy: user.id }).returning();
    await audit(db, { userId: user.id, action: "expense.subscription.create", entity: "subscription", entityId: row.id, newValue: row });
    await markAll(db, earliestCharge(row));
    return done(`Added ${name}.`);
  }

  const [old] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!old) return fail("That subscription no longer exists.");
  // Keep past charges at the amount that was really in force: log them before the amount changes.
  if (old.status !== "trial" && (old.amount !== values.amount || old.currency !== values.currency)) {
    const from = (await dirtyWindow(db, earliestCharge(old)))?.from;
    const past = from ? chargeDates(spec(old), from, today()) : [];
    if (past.length) {
      await db
        .insert(subscriptionOccurrences)
        .values(past.map((d) => ({ subscriptionId: id, chargeDate: d, expectedAmount: old.amount, currency: old.currency })))
        .onConflictDoNothing();
    }
  }
  const [row] = await db.update(subscriptions).set({ ...values, updatedAt: new Date() }).where(eq(subscriptions.id, id)).returning();
  await audit(db, { userId: user.id, action: "expense.subscription.update", entity: "subscription", entityId: id, oldValue: old, newValue: row });
  const a = earliestCharge(old);
  const b = earliestCharge(row);
  await markAll(db, a < b ? a : b);
  return done(`Saved ${name}.`);
}

export async function cancelSubscription(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const id = Number(str(form, "id"));
  const endDate = str(form, "endDate") || today();
  if (!isDate(endDate)) return fail("End date must be a date.");
  const [old] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!old) return fail("That subscription no longer exists.");
  const [row] = await db.update(subscriptions).set({ status: "cancelled", endDate, nextRenewal: null, updatedAt: new Date() }).where(eq(subscriptions.id, id)).returning();
  await audit(db, { userId: user.id, action: "expense.subscription.cancel", entity: "subscription", entityId: id, oldValue: { status: old.status, endDate: old.endDate }, newValue: { status: row.status, endDate } });
  // charges on or before the end date stay; anything after it disappears
  const from = old.endDate && old.endDate < endDate ? old.endDate : endDate;
  await markAll(db, from);
  return done(`${old.name} cancelled as of ${endDate}.`);
}

/** Hard delete, for entries created by mistake: removes every past charge too. */
export async function deleteSubscription(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const id = Number(str(form, "id"));
  const [old] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!old) return fail("That subscription no longer exists.");
  await db.delete(subscriptions).where(eq(subscriptions.id, id));
  await audit(db, { userId: user.id, action: "expense.subscription.delete", entity: "subscription", entityId: id, oldValue: old });
  await markAll(db, earliestCharge(old));
  return done(`${old.name} deleted.`);
}

/** Correct what a renewal actually cost (e.g. FX, tax, a price change). Blank = use the expected amount. */
export async function correctOccurrence(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const id = Number(str(form, "id"));
  const raw = str(form, "actualAmount");
  const actual = raw === "" ? null : amount(raw);
  if (raw !== "" && actual === null) return fail("Amount must be a number.");
  const [old] = await db.select().from(subscriptionOccurrences).where(eq(subscriptionOccurrences.id, id));
  if (!old) return fail("That renewal no longer exists.");
  const note = str(form, "note").slice(0, 500) || null;
  const [row] = await db.update(subscriptionOccurrences).set({ actualAmount: actual, note }).where(eq(subscriptionOccurrences.id, id)).returning();
  await audit(db, { userId: user.id, action: "expense.occurrence.update", entity: "subscription_occurrence", entityId: id, oldValue: { actualAmount: old.actualAmount, note: old.note }, newValue: { actualAmount: row.actualAmount, note: row.note } });
  await markDirtyRange(db, null, old.chargeDate, old.chargeDate);
  return done(`Saved the ${old.chargeDate} charge.`);
}

// ---------------------------------------------------------------- one-off expenses

export async function createExpense(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const date = str(form, "date");
  const name = str(form, "name").slice(0, 255);
  const amt = amount(str(form, "amount"));
  const currency = str(form, "currency").toUpperCase();
  const category = str(form, "category") || "other";
  if (!isDate(date)) return fail("Date is required.");
  if (!name) return fail("Name is required.");
  if (amt === null) return fail("Amount must be a number.");
  if (!knownCurrency(await loadFx(db), currency)) return fail(`No exchange rate for ${currency} yet.`);
  if (!CATEGORIES.some((c) => c.value === category)) return fail("Choose a category.");
  const scope = await parseScope(db, form);
  if ("error" in scope) return fail(scope.error);
  const [row] = await db
    .insert(expenses)
    .values({ date, name, amount: amt, currency, category, ...scope, countsAsAdSpend: form.get("countsAsAdSpend") === "on", notes: str(form, "notes") || null, createdBy: user.id })
    .returning();
  await audit(db, { userId: user.id, action: "expense.create", entity: "expense", entityId: row.id, newValue: row });
  await markAll(db, date);
  return done(`Added ${name} on ${date}.`);
}

export async function deleteExpense(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const id = Number(str(form, "id"));
  const [old] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!old) return fail("That expense no longer exists.");
  await db.delete(expenses).where(eq(expenses.id, id));
  await audit(db, { userId: user.id, action: "expense.delete", entity: "expense", entityId: id, oldValue: old });
  await markAll(db, old.date);
  return done(`Deleted ${old.name}.`);
}

/** CSV: date, name, amount, currency, category, scope (store|region|shared), store_or_region. Split equally. */
export async function importExpensesCsv(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return fail("Choose a CSV file first.");
  if (f.size > 2 * 1024 * 1024) return fail("The file is larger than 2 MB.");
  const rows = parseCsv(await f.text());
  if (!rows.length) return fail("The file has no data rows.");
  const missingCols = ["date", "name", "amount"].filter((c) => !(c in rows[0]));
  if (missingCols.length) return fail(`Missing column(s): ${missingCols.join(", ")}.`);
  const fx = await loadFx(db);
  const sr = await listStoresAndRegions(db);
  const errors: string[] = [];
  const values: (typeof expenses.$inferInsert)[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const amt = amount(r.amount ?? "");
    const currency = (r.currency || "USD").toUpperCase();
    const category = (r.category || "other").toLowerCase();
    const scope = (r.scope || "shared").toLowerCase();
    const key = (r.store_or_region ?? "").trim().toLowerCase();
    if (!isDate(r.date ?? "")) return errors.push(`Line ${line}: date "${r.date ?? ""}" is not YYYY-MM-DD`);
    if (!r.name) return errors.push(`Line ${line}: name is empty`);
    if (amt === null) return errors.push(`Line ${line}: amount "${r.amount ?? ""}" is not a number`);
    if (!knownCurrency(fx, currency)) return errors.push(`Line ${line}: no exchange rate for "${currency}"`);
    if (!CATEGORIES.some((c) => c.value === category)) return errors.push(`Line ${line}: unknown category "${category}"`);
    let storeId: number | null = null;
    let regionId: number | null = null;
    if (scope === "store") {
      const s = sr.find((x) => String(x.store_id) === key || x.store_name.toLowerCase() === key);
      if (!s) return errors.push(`Line ${line}: unknown store "${r.store_or_region ?? ""}"`);
      storeId = s.store_id;
    } else if (scope === "region") {
      const s = sr.find((x) => String(x.region_id) === key || x.region_code.toLowerCase() === key || x.region_name.toLowerCase() === key);
      if (!s) return errors.push(`Line ${line}: unknown region "${r.store_or_region ?? ""}"`);
      regionId = s.region_id;
    } else if (scope !== "shared") return errors.push(`Line ${line}: scope must be store, region or shared`);
    values.push({ date: r.date, name: r.name.slice(0, 255), amount: amt, currency, category, scope, storeId, regionId, allocation: "equal", createdBy: user.id });
  });
  if (values.length) {
    const inserted = await db.insert(expenses).values(values).returning({ id: expenses.id });
    await audit(db, { userId: user.id, action: "expense.import", entity: "expense", newValue: { count: inserted.length, ids: inserted.map((x) => x.id), errors: errors.length } });
    await markAll(db, values.map((v) => v.date).sort()[0]);
    revalidatePath("/expenses");
  }
  return { ok: errors.length === 0, message: `Imported ${values.length} expense${values.length === 1 ? "" : "s"}${errors.length ? `, ${errors.length} line(s) with errors` : ""}.`, errors };
}

// ---------------------------------------------------------------- iCal feed

/** Create a feed token. Only its hash is stored; the full URL is shown once. */
export async function createCalendarToken(_: ActionResult, _form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const token = randomToken(32);
  const hash = sha256(token);
  await db.insert(calendarTokens).values({ tokenHash: hash, userId: user.id });
  await audit(db, { userId: user.id, action: "calendar_token.create", entity: "calendar_token", entityId: hash.slice(0, 12) });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  revalidatePath("/expenses");
  return { ok: true, message: "Feed created. Copy the URL now: it is not shown again. Add it to your calendar app as a subscribed calendar.", reveal: `${proto}://${host}/api/ical/${token}` };
}

export async function revokeCalendarToken(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const hash = str(form, "hash");
  await db.delete(calendarTokens).where(eq(calendarTokens.tokenHash, hash));
  await audit(db, { userId: user.id, action: "calendar_token.revoke", entity: "calendar_token", entityId: hash.slice(0, 12) });
  return done("Feed revoked.");
}
