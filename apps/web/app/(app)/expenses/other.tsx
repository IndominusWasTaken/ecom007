import { Download, Plus, Upload } from "lucide-react";
import { getDb, sql } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { knownCurrencies, stamp, today } from "@/lib/forms";
import { cn } from "@/lib/cn";
import { correctOccurrence, createCalendarToken, createExpense, deleteExpense, importExpensesCsv, revokeCalendarToken } from "./actions";
import { ScopeFields } from "./client";
import { CATEGORIES, categoryLabel } from "./constants";
import { converter, storeOpts } from "./data";

// ---------------------------------------------------------------- renewal log

export async function RenewalsTab({ currency }: { currency: "USD" | "EUR" }) {
  const db = getDb();
  const [res, conv] = await Promise.all([
    db.execute<{ id: number; charge_date: string; name: string; status: string; expected: string; actual: string | null; currency: string; note: string | null }>(sql`
      select o.id, o.charge_date::text, s.name, s.status, o.expected_amount::text expected, o.actual_amount::text actual, o.currency, o.note
      from subscription_occurrences o join subscriptions s on s.id = o.subscription_id
      where o.charge_date <= ${today()} order by o.charge_date desc, s.name limit 400`),
    converter(currency),
  ]);
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm text-muted">
        Every renewal that has come due, with the amount expected at the time. If the card was charged a different amount (FX, VAT, a price change), enter what was actually charged: profit for that day is
        recalculated for all stores.
      </p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Subscription</th>
              <th className="num">Expected</th>
              <th className="num">In {currency}</th>
              <th>Actual charged · note</th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map((o) => {
              const used = o.actual ?? o.expected;
              const diff = o.actual !== null && Number(o.actual) !== Number(o.expected);
              return (
                <tr key={o.id}>
                  <td className="tabular">{o.charge_date}</td>
                  <td>{o.name}</td>
                  <td className={cn("num", diff && "text-muted line-through")}>{fmt(Number(o.expected), "money", o.currency)}</td>
                  <td className="num">{fmt(conv(used, o.currency, o.charge_date), "money", currency)}</td>
                  <td>
                    <ActionForm action={correctOccurrence} className="flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="id" value={o.id} />
                      <input name="actualAmount" inputMode="decimal" defaultValue={o.actual ? Number(o.actual).toString() : ""} placeholder={Number(o.expected).toString()} aria-label="Actual amount" className="input h-7 w-24" />
                      <span className="text-xs text-muted">{o.currency}</span>
                      <input name="note" defaultValue={o.note ?? ""} placeholder="note" aria-label="Note" className="input h-7 w-40" />
                      <SubmitButton variant="plain" className="btn-sm">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              );
            })}
            {res.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted">
                  No renewals logged yet. They are created daily as charges come due.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one-off expenses

export async function OneOffTab({ currency }: { currency: "USD" | "EUR" }) {
  const db = getDb();
  const [res, stores, currencies, conv] = await Promise.all([
    db.execute<{ id: number; date: string; name: string; category: string; amount: string; currency: string; scope: string; store: string | null; region: string | null; allocation: string; counts_as_ad_spend: boolean; notes: string | null; who: string | null; created_at: string }>(sql`
      select e.id, e.date::text, e.name, e.category, e.amount::text, e.currency, e.scope, s.name store, r.name region, e.allocation, e.counts_as_ad_spend, e.notes, u.username who, e.created_at
      from expenses e left join stores s on s.id = e.store_id left join regions r on r.id = e.region_id left join users u on u.id = e.created_by
      order by e.date desc, e.id desc limit 500`),
    storeOpts(),
    knownCurrencies(db),
    converter(currency),
  ]);
  const total = res.rows.reduce((a, e) => a + conv(e.amount, e.currency, e.date), 0);
  return (
    <div className="flex flex-col gap-5">
      <details className="card p-4 [&_summary::-webkit-details-marker]:hidden" open={res.rows.length === 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
          <Plus size={16} /> Add one-off expense
        </summary>
        <ActionForm action={createExpense} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col">
            <span className="label">Date</span>
            <input type="date" name="date" required defaultValue={today()} className="input" />
          </label>
          <label className="flex w-full flex-col sm:w-56">
            <span className="label">Name</span>
            <input name="name" required className="input" placeholder="e.g. Product photos" />
          </label>
          <label className="flex flex-col">
            <span className="label">Amount</span>
            <input name="amount" required inputMode="decimal" placeholder="0.00" className="input w-28" />
          </label>
          <label className="flex flex-col">
            <span className="label">Currency</span>
            <select name="currency" defaultValue="USD" className="input">
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="label">Category</span>
            <select name="category" defaultValue="other" className="input">
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <ScopeFields stores={stores} />
          <label className="flex w-full flex-col sm:w-72">
            <span className="label">Notes</span>
            <input name="notes" className="input" />
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="countsAsAdSpend" /> Counts as ad spend
          </label>
          <SubmitButton>Add expense</SubmitButton>
        </ActionForm>
      </details>

      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Import CSV</h2>
            <p className="mt-0.5 text-xs text-muted">
              Columns: date, name, amount, currency, category, scope (store | region | shared), store_or_region (store name/id or region code). Imported rows are split equally.
            </p>
          </div>
          <a className="btn btn-sm" href="/api/expenses/template">
            <Download size={12} /> Template
          </a>
        </div>
        <ActionForm action={importExpensesCsv} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="file" name="file" accept=".csv,text/csv" required className="input max-w-full py-1.5 file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium" />
          <SubmitButton>
            <Upload size={14} /> Import
          </SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">One-off expenses</h2>
          <span className="text-sm text-muted">
            Total <strong className="tabular-nums text-ink">{fmt(total, "money", currency)}</strong>
          </span>
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th className="num">In {currency}</th>
                <th>Scope</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {res.rows.map((e) => (
                <tr key={e.id}>
                  <td className="tabular">{e.date}</td>
                  <td className="max-w-[16rem]">
                    <div className="truncate">{e.name}</div>
                    {(e.notes || e.counts_as_ad_spend) && (
                      <div className="truncate text-xs text-muted">
                        {e.counts_as_ad_spend && <span className="pill mr-1 bg-warn-soft text-warn">ad spend</span>}
                        {e.notes}
                      </div>
                    )}
                  </td>
                  <td>{categoryLabel(e.category)}</td>
                  <td className="num">{fmt(Number(e.amount), "money", e.currency)}</td>
                  <td className="num">{fmt(conv(e.amount, e.currency, e.date), "money", currency)}</td>
                  <td className="text-xs">
                    {e.scope === "store" ? e.store : e.scope === "region" ? e.region : "Shared"}
                    {e.scope !== "store" && <span className="text-muted"> · {e.allocation === "revenue" ? "by revenue" : e.allocation === "fixed" ? "fixed %" : "equal"}</span>}
                  </td>
                  <td className="text-xs text-muted">
                    {stamp(e.created_at).slice(0, 10)} {e.who ? `· ${e.who}` : ""}
                  </td>
                  <td>
                    <ActionForm action={deleteExpense} confirm={`Delete “${e.name}” (${e.date})?`}>
                      <input type="hidden" name="id" value={e.id} />
                      <SubmitButton variant="danger" className="btn-sm">
                        Delete
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
              {res.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No one-off expenses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- iCal feed

export async function FeedTab() {
  const res = await getDb().execute<{ token_hash: string; created_at: string; who: string | null }>(sql`
    select t.token_hash, t.created_at, u.username who from calendar_tokens t left join users u on u.id = t.user_id order by t.created_at desc`);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <section className="card p-4">
        <h2 className="font-semibold">Private calendar feed</h2>
        <p className="mt-1 text-sm text-muted">
          Subscribe to your renewals from Google Calendar, Apple Calendar or Outlook. The feed lists every renewal from 3 months back to 12 months ahead as all-day events. Anyone with the URL can read it,
          so treat it like a password; revoke it here if it leaks.
        </p>
        <ActionForm action={createCalendarToken} className="mt-3">
          <SubmitButton>Create feed URL</SubmitButton>
        </ActionForm>
      </section>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Feed</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.token_hash}>
                <td className="font-mono text-xs">…{r.token_hash.slice(0, 10)}</td>
                <td className="text-muted">
                  {stamp(r.created_at)} {r.who ? `· ${r.who}` : ""}
                </td>
                <td>
                  <ActionForm action={revokeCalendarToken} confirm="Revoke this feed? Calendars using it stop updating.">
                    <input type="hidden" name="hash" value={r.token_hash} />
                    <SubmitButton variant="danger" className="btn-sm">
                      Revoke
                    </SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
            {res.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted">
                  No feeds yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
