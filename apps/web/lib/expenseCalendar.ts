import "server-only";
import { chargeDates, type BillingCycle } from "@ecom/core/recurrence";
import { sql, type Db } from "@ecom/db";

/** One expense charge on a date: a subscription renewal or a one-off expense. */
export interface Charge {
  date: string;
  kind: "subscription" | "expense";
  id: number;
  name: string;
  amount: number;
  currency: string;
  /** Trials cost nothing until converted (same rule as the metric engine); shown but not totalled. */
  trial: boolean;
  /** Past renewal with a logged (possibly corrected) amount. */
  logged: boolean;
  countsAsAdSpend: boolean;
  manageUrl: string | null;
  vendor: string | null;
  cycle: string | null;
}

/**
 * Charges dated within [from, to], following the engine (apps/worker/src/rebuild.ts expenseCharges):
 * schedule from chargeDates, logged occurrences override the amount, cancelled subscriptions stop at end_date.
 */
export async function chargesBetween(db: Db, from: string, to: string): Promise<Charge[]> {
  const [subs, occ, one] = await Promise.all([
    db.execute<{
      id: number;
      name: string;
      vendor: string | null;
      amount: string;
      currency: string;
      cycle: string;
      every_n_months: number | null;
      anchor_date: string;
      start_date: string | null;
      end_date: string | null;
      status: string;
      updated_at: string;
      counts_as_ad_spend: boolean;
      manage_url: string | null;
    }>(sql`select id, name, vendor, amount::text, currency, cycle, every_n_months, anchor_date::text, start_date::text, end_date::text, status, updated_at::text,
             counts_as_ad_spend, manage_url
           from subscriptions where status <> 'cancelled' or end_date is not null`),
    db.execute<{ subscription_id: number; charge_date: string; amount: string; currency: string; logged: boolean }>(sql`
      select subscription_id, charge_date::text, coalesce(actual_amount, expected_amount)::text amount, currency, true logged
      from subscription_occurrences where charge_date between ${from} and ${to}`),
    db.execute<{ id: number; date: string; name: string; amount: string; currency: string; counts_as_ad_spend: boolean }>(sql`
      select id, date::text, name, amount::text, currency, counts_as_ad_spend from expenses where date between ${from} and ${to}`),
  ]);
  const occBy = new Map(occ.rows.map((o) => [`${o.subscription_id}:${o.charge_date}`, o]));
  const out: Charge[] = [];
  for (const s of subs.rows) {
    const endDate = s.status === "cancelled" ? (s.end_date ?? s.updated_at.slice(0, 10)) : s.end_date;
    const dates = chargeDates({ cycle: s.cycle as BillingCycle, everyNMonths: s.every_n_months, anchorDate: s.anchor_date, startDate: s.start_date, endDate }, from, to);
    for (const d of dates) {
      const o = occBy.get(`${s.id}:${d}`);
      out.push({
        date: d,
        kind: "subscription",
        id: s.id,
        name: s.name,
        amount: Number(o ? o.amount : s.amount),
        currency: o ? o.currency : s.currency,
        trial: s.status === "trial",
        logged: !!o,
        countsAsAdSpend: s.counts_as_ad_spend,
        manageUrl: s.manage_url,
        vendor: s.vendor,
        cycle: s.cycle,
      });
    }
  }
  for (const e of one.rows) {
    out.push({ date: e.date, kind: "expense", id: e.id, name: e.name, amount: Number(e.amount), currency: e.currency, trial: false, logged: true, countsAsAdSpend: e.counts_as_ad_spend, manageUrl: null, vendor: null, cycle: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}
