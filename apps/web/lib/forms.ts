import "server-only";
import { addDays, todayIn } from "@ecom/core/dates";
import { BUSINESS_TZ } from "@ecom/core/config";
import type { FxTable } from "@ecom/core/fx";
import { sql, type Db } from "@ecom/db";

/** Small parsing helpers shared by the cost and expense server actions. */

export const today = () => todayIn(BUSINESS_TZ);

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** A non-negative decimal written with "." or ","; null when invalid. */
export function amount(s: string): string | null {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return t;
}

/** Currencies we can convert: known to the ECB table (or EUR itself). */
export function knownCurrency(fx: FxTable, ccy: string): boolean {
  if (!/^[A-Z]{3}$/.test(ccy)) return false;
  try {
    fx.perEur(ccy, today());
    return true;
  } catch {
    return false;
  }
}

/**
 * First day worth rebuilding: the earliest order we hold, never more than 800 days back.
 * Marking days before any data would only create expense-only rows nobody looks at.
 */
export async function historyStart(db: Db, storeId: number | null = null): Promise<string> {
  const res = await db.execute<{ d: string | null }>(
    sql`select min(local_date)::text d from orders where ${storeId === null ? sql`true` : sql`store_id = ${storeId}`}`,
  );
  const floor = addDays(today(), -800);
  const d = res.rows[0]?.d;
  return d && d > floor ? d : floor;
}

/** Clamp a rebuild window to [historyStart, today]; null when nothing in the past is affected. */
export async function dirtyWindow(db: Db, from: string, storeId: number | null = null): Promise<{ from: string; to: string } | null> {
  const t = today();
  if (from > t) return null;
  const start = await historyStart(db, storeId);
  return { from: from < start ? start : from, to: t };
}

/** Currencies the FX table can convert, for currency pickers (EUR first, then USD). */
export async function knownCurrencies(db: Db): Promise<string[]> {
  const res = await db.execute<{ currency: string }>(sql`select distinct currency from fx_rates order by currency`);
  const rest = res.rows.map((r) => r.currency).filter((c) => c !== "EUR" && c !== "USD");
  return ["USD", "EUR", ...rest];
}

const STAMP = new Intl.DateTimeFormat("sv-SE", { timeZone: BUSINESS_TZ, dateStyle: "short", timeStyle: "short" });
/** "2026-10-11 18:48" in business time, for created/imported stamps (timestamps arrive as strings or Dates). */
export const stamp = (d: string | Date) => STAMP.format(new Date(d));
