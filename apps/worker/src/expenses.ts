import { addDays, todayIn } from "@ecom/core/dates";
import { BUSINESS_TZ } from "@ecom/core/config";
import { chargeDates, defaultReminderDays, nextChargeDate, type BillingCycle } from "@ecom/core/recurrence";
import { formatMoney } from "@ecom/core/money";
import { lookupDomainExpiry } from "@ecom/connectors";
import { eq, getDb, markDirtyRange, sql, subscriptionOccurrences, subscriptions, type Db } from "@ecom/db";
import { alert } from "./notifier";

type Sub = typeof subscriptions.$inferSelect;

const spec = (s: Sub) => ({ cycle: s.cycle as BillingCycle, everyNMonths: s.everyNMonths, anchorDate: s.anchorDate, startDate: s.startDate, endDate: s.endDate });

/**
 * Daily at 08:00 Sofia: create renewal log entries for charges due today or earlier,
 * refresh next renewal dates and raise reminders ahead of each renewal.
 */
export async function runRenewals(db: Db = getDb(), today = todayIn(BUSINESS_TZ)) {
  const subs = await db.select().from(subscriptions);
  let created = 0;
  for (const s of subs) {
    if (s.status === "cancelled" && (!s.endDate || s.endDate < addDays(today, -400))) continue;
    // log every charge up to today that has no entry yet (last 400 days)
    for (const d of chargeDates(spec(s), addDays(today, -400), today)) {
      if (s.status === "trial") continue;
      const r = await db
        .insert(subscriptionOccurrences)
        .values({ subscriptionId: s.id, chargeDate: d, expectedAmount: s.amount, currency: s.currency })
        .onConflictDoNothing()
        .returning({ id: subscriptionOccurrences.id });
      created += r.length;
    }
    const next = s.status === "cancelled" ? null : nextChargeDate(spec(s), addDays(today, 1));
    if (next !== s.nextRenewal) await db.update(subscriptions).set({ nextRenewal: next }).where(eq(subscriptions.id, s.id));
    if (next && s.status !== "cancelled") {
      const lead = s.reminderDays ?? defaultReminderDays(spec(s));
      if (next <= addDays(today, lead)) {
        await alert({
          kind: "renewal",
          severity: "warning",
          title: `${s.name} renews on ${next}`,
          body: `${formatMoney(s.amount, s.currency)} · ${s.cycle.replace("_", " ")}${s.paymentMethod ? ` · ${s.paymentMethod}` : ""}`,
          link: s.manageUrl ?? "/expenses",
          dedupeKey: `renewal:${s.id}:${next}`,
        });
      }
    }
    if (s.domainExpiry && s.domainExpiry <= addDays(today, 30)) {
      await alert({ kind: "renewal", severity: "warning", title: `Domain ${s.domain} expires on ${s.domainExpiry}`, link: "/expenses", dedupeKey: `domain:${s.id}:${s.domainExpiry}` });
    }
  }
  return created;
}

export async function refreshDomainExpiries(db: Db = getDb()) {
  const subs = await db.execute<any>(sql`select id, domain from subscriptions where domain is not null and domain <> '' and status <> 'cancelled'`);
  let n = 0;
  for (const s of subs.rows) {
    const r = await lookupDomainExpiry(s.domain);
    if (r.expiry) {
      await db.update(subscriptions).set({ domainExpiry: r.expiry, domainCheckedAt: new Date() }).where(eq(subscriptions.id, s.id));
      n++;
    } else {
      await db.update(subscriptions).set({ domainCheckedAt: new Date() }).where(eq(subscriptions.id, s.id));
    }
  }
  return n;
}

/** After an expense or subscription changes, every store-day it touches must be rebuilt. */
export async function markExpenseDirty(db: Db, from: string, to: string) {
  await markDirtyRange(db, null, from, to);
}
