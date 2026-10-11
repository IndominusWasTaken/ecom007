import Link from "next/link";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { allocate, type AllocationMethod } from "@ecom/core/allocation";
import { addDays, daysBetween } from "@ecom/core/dates";
import { cycleMonths, nextChargeDate, type BillingCycle } from "@ecom/core/recurrence";
import { getDb, sql, subscriptions as subsTable, asc } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { knownCurrencies, stamp, today } from "@/lib/forms";
import { chargesBetween } from "@/lib/expenseCalendar";
import { withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/cn";
import { cancelSubscription, deleteSubscription, saveSubscription } from "./actions";
import { SubscriptionFields, type SubInitial } from "./client";
import { categoryLabel, cycleLabel } from "./constants";
import { converter, storeOpts } from "./data";

type Sub = typeof subsTable.$inferSelect;

const STATUS_CLS: Record<string, string> = { active: "bg-pos-soft text-pos", trial: "bg-accent-soft text-accent", cancelled: "bg-surface-2 text-muted" };

function toInitial(s: Sub): SubInitial {
  return {
    id: s.id,
    name: s.name,
    vendor: s.vendor,
    category: s.category,
    amount: s.amount,
    currency: s.currency,
    cycle: s.cycle,
    everyNMonths: s.everyNMonths,
    anchorDate: s.anchorDate,
    startDate: s.startDate,
    endDate: s.endDate,
    scope: s.scope,
    storeId: s.storeId,
    regionId: s.regionId,
    allocation: s.allocation,
    percents: s.allocationPercents,
    status: s.status,
    paymentMethod: s.paymentMethod,
    manageUrl: s.manageUrl,
    notes: s.notes,
    countsAsAdSpend: s.countsAsAdSpend,
    reminderDays: s.reminderDays,
    domain: s.domain,
    domainExpiry: s.domainExpiry,
  };
}

export async function SubscriptionsTab({ currency, editId, showCancelled, sp }: { currency: "USD" | "EUR"; editId: number | null; showCancelled: boolean; sp: SearchParams }) {
  const db = getDb();
  const t = today();
  const [subs, stores, currencies, conv, next30, revenue] = await Promise.all([
    db.select().from(subsTable).orderBy(asc(subsTable.name)),
    storeOpts(),
    knownCurrencies(db),
    converter(currency),
    chargesBetween(db, t, addDays(t, 29)),
    db.execute<{ store_id: number; rev: string }>(sql`select store_id, coalesce(sum(order_revenue_usd), 0)::text rev from orders
      where not test and local_date between ${addDays(t, -30)} and ${addDays(t, -1)} group by store_id`),
  ]);
  const revByStore = Object.fromEntries(revenue.rows.map((r) => [Number(r.store_id), r.rev]));
  const editing = editId ? subs.find((s) => s.id === editId) : undefined;

  // monthly-equivalent per subscription, in the display currency at today's rate
  const rows = subs.map((s) => {
    const spec = { cycle: s.cycle as BillingCycle, everyNMonths: s.everyNMonths, anchorDate: s.anchorDate, startDate: s.startDate, endDate: s.endDate };
    const months = cycleMonths(spec);
    const amountDisp = conv(s.amount, s.currency);
    const monthly = months ? amountDisp / months : null;
    const next = s.status === "cancelled" ? null : nextChargeDate(spec, t);
    return { s, monthly, yearly: monthly === null ? null : monthly * 12, next, counted: s.status === "active" };
  });
  const visible = rows.filter((r) => showCancelled || r.s.status !== "cancelled");
  const counted = rows.filter((r) => r.counted && r.monthly !== null);
  const monthlyTotal = counted.reduce((a, r) => a + r.monthly!, 0);
  const next30Total = next30.filter((c) => !c.trial).reduce((a, c) => a + conv(c.amount, c.currency, c.date), 0);

  const byCategory = new Map<string, number>();
  for (const r of counted) byCategory.set(r.s.category, (byCategory.get(r.s.category) ?? 0) + r.monthly!);
  // by region: split each subscription across stores exactly as the engine allocates charges
  const byRegion = new Map<string, number>();
  for (const r of counted) {
    const ids = r.s.scope === "store" && r.s.storeId ? [r.s.storeId] : r.s.scope === "region" && r.s.regionId ? stores.filter((x) => x.regionId === r.s.regionId).map((x) => x.id) : stores.map((x) => x.id);
    const shares = allocate({ amount: r.monthly!, storeIds: ids, method: r.s.allocation as AllocationMethod, fixedPercents: (r.s.allocationPercents ?? undefined) as Record<number, number> | undefined, revenueByStore: revByStore });
    for (const [id, v] of shares) {
      const region = stores.find((x) => x.id === id)?.regionName ?? "Other";
      byRegion.set(region, (byRegion.get(region) ?? 0) + v.toNumber());
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Monthly (active, equivalent)" value={fmt(monthlyTotal, "money", currency)} />
        <Stat label="Yearly (active, equivalent)" value={fmt(monthlyTotal * 12, "money", currency)} />
        <Stat label="Charges in the next 30 days" value={fmt(next30Total, "money", currency)} hint={`${next30.filter((c) => !c.trial).length} charges incl. one-offs`} />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Breakdown title="Monthly by category" rows={[...byCategory].map(([k, v]) => [categoryLabel(k), v])} total={monthlyTotal} currency={currency} />
        <Breakdown title="Monthly by region (after allocation)" rows={[...byRegion]} total={monthlyTotal} currency={currency} />
      </section>

      {editing ? (
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Edit {editing.name}</h2>
            <Link href={withParams("/expenses", sp, { edit: null })} className="btn btn-sm">
              Close
            </Link>
          </div>
          <p className="mb-3 text-xs text-muted">Changing the amount keeps past charges at the old amount (they are logged in the renewal log first); future charges use the new amount.</p>
          <ActionForm action={saveSubscription}>
            <SubscriptionFields stores={stores} currencies={currencies} today={t} initial={toInitial(editing)} />
            <div className="mt-3">
              <SubmitButton>Save changes</SubmitButton>
            </div>
          </ActionForm>
        </section>
      ) : (
        <details className="card p-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
            <Plus size={16} /> Add subscription
          </summary>
          <ActionForm action={saveSubscription} className="mt-3">
            <SubscriptionFields stores={stores} currencies={currencies} today={t} />
            <div className="mt-3">
              <SubmitButton>Add subscription</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Subscriptions</h2>
          <Link className="text-xs text-muted underline" href={withParams("/expenses", sp, { cancelled: showCancelled ? null : "1" })}>
            {showCancelled ? "Hide cancelled" : `Show cancelled (${rows.filter((r) => r.s.status === "cancelled").length})`}
          </Link>
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Cycle</th>
                <th className="num">Monthly ({currency})</th>
                <th className="num">Yearly ({currency})</th>
                <th>Next renewal</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Domain expiry</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ s, monthly, yearly, next }) => {
                const days = next ? daysBetween(t, next) : null;
                return (
                  <tr key={s.id} className={cn(s.status === "cancelled" && "opacity-60")}>
                    <td className="max-w-[16rem]">
                      <div className="truncate font-medium" title={s.name}>
                        {s.name}
                      </div>
                      <div className="truncate text-xs text-muted" title={s.notes ?? undefined}>
                        {[s.vendor, s.notes].filter(Boolean).join(" · ")}
                        {s.countsAsAdSpend && <span className="pill ml-1 bg-warn-soft text-warn">ad spend</span>}
                      </div>
                    </td>
                    <td>{categoryLabel(s.category)}</td>
                    <td className="num">{fmt(Number(s.amount), "money", s.currency)}</td>
                    <td>{cycleLabel(s.cycle, s.everyNMonths)}</td>
                    <td className="num">{monthly === null ? "—" : fmt(monthly, "money", currency)}</td>
                    <td className="num">{yearly === null ? "—" : fmt(yearly, "money", currency)}</td>
                    <td className="tabular">
                      {next ?? "—"}
                      {days !== null && days <= 7 && <span className="pill ml-1 bg-warn-soft text-warn">{days === 0 ? "today" : `in ${days}d`}</span>}
                    </td>
                    <td className="text-xs">
                      <ScopeLabel s={s} stores={stores} />
                    </td>
                    <td>
                      <span className={cn("pill", STATUS_CLS[s.status])}>{s.status}</span>
                      {s.status === "cancelled" && s.endDate && <div className="text-xs text-muted">ended {s.endDate}</div>}
                    </td>
                    <td className="text-xs">{s.paymentMethod ?? "—"}</td>
                    <td className="text-xs">
                      {s.domain ? (
                        <>
                          <div>{s.domain}</div>
                          <div className={cn(s.domainExpiry && s.domainExpiry <= addDays(t, 30) ? "text-warn" : "text-muted")}>
                            {s.domainExpiry ? `expires ${s.domainExpiry}` : "expiry unknown"}
                            {s.domainCheckedAt ? ` · checked ${stamp(s.domainCheckedAt).slice(0, 10)}` : ""}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {s.manageUrl && (
                          <a href={s.manageUrl} target="_blank" rel="noreferrer noopener" className="btn btn-sm" title="Manage">
                            <ExternalLink size={12} />
                          </a>
                        )}
                        <Link href={withParams("/expenses", sp, { edit: String(s.id) })} className="btn btn-sm" title="Edit">
                          <Pencil size={12} /> Edit
                        </Link>
                        {s.status !== "cancelled" && (
                          <ActionForm action={cancelSubscription} confirm={`Cancel ${s.name} as of today? Charges after today stop.`}>
                            <input type="hidden" name="id" value={s.id} />
                            <SubmitButton variant="plain" className="btn-sm">
                              Cancel
                            </SubmitButton>
                          </ActionForm>
                        )}
                        <ActionForm action={deleteSubscription} confirm={`Delete ${s.name} completely, including its past charges? Use Cancel to just stop it.`}>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton variant="danger" className="btn-sm">
                            Delete
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-muted">
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Monthly and yearly equivalents use today&apos;s exchange rate. Trials and cancelled subscriptions are not in the totals.</p>
      </section>
    </div>
  );
}

function ScopeLabel({ s, stores }: { s: Pick<Sub, "scope" | "storeId" | "regionId" | "allocation" | "allocationPercents">; stores: { id: number; name: string; regionId: number; regionName: string }[] }) {
  if (s.scope === "store") return <>{stores.find((x) => x.id === s.storeId)?.name ?? "Store"}</>;
  const where = s.scope === "region" ? (stores.find((x) => x.regionId === s.regionId)?.regionName ?? "Region") : "Shared";
  const how =
    s.allocation === "fixed" && s.allocationPercents
      ? Object.entries(s.allocationPercents)
          .map(([id, p]) => `${stores.find((x) => String(x.id) === id)?.name ?? id} ${p}%`)
          .join(", ")
      : s.allocation === "revenue"
        ? "by revenue"
        : "equal split";
  return (
    <>
      {where}
      <div className="text-muted">{how}</div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Breakdown({ title, rows, total, currency }: { title: string; rows: [string, number][]; total: number; currency: string }) {
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {sorted.map(([k, v]) => (
          <li key={k} className="text-sm">
            <div className="flex justify-between gap-2">
              <span>{k}</span>
              <span className="tabular-nums">{fmt(v, "money", currency)}</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-surface-2">
              <div className="h-1 rounded-full bg-accent" style={{ width: `${total ? Math.max(1, (v / total) * 100) : 0}%` }} />
            </div>
          </li>
        ))}
        {sorted.length === 0 && <li className="text-sm text-muted">Nothing active.</li>}
      </ul>
    </div>
  );
}
