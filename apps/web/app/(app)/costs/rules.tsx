import { Upload } from "lucide-react";
import { getDb, sql } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { knownCurrencies, stamp, today } from "@/lib/forms";
import { createHandlingRule, createPaymentFeeRule, createShippingRule, importShippingActuals } from "./actions";
import { ShippingTableEditor } from "./client";

type StoreRow = { id: number; name: string; currency: string };

async function loadStores() {
  const res = await getDb().execute<StoreRow>(sql`select id, name, currency from stores order by id`);
  return res.rows;
}

/** The row in force today: latest effective_from on or before today (rows come sorted newest first). */
function inForceToday<T extends { effective_from: string }>(rows: T[]): T | null {
  const t = today();
  return rows.find((r) => r.effective_from <= t) ?? null;
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function CurrencySelect({ currencies, value }: { currencies: string[]; value: string }) {
  return (
    <select name="currency" defaultValue={value} className="input">
      {currencies.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}

function StatusPill({ row, current }: { row: { effective_from: string }; current: unknown }) {
  if (row === current) return <span className="pill bg-accent-soft text-accent">in force</span>;
  if (row.effective_from > today()) return <span className="pill bg-surface-2 text-muted">scheduled</span>;
  return <span className="pill text-muted">superseded</span>;
}

// ---------------------------------------------------------------- shipping

type ShipRow = {
  id: number;
  store_id: number;
  mode: string;
  flat_amount: string;
  currency: string;
  table: { country: string; basis: string; min: number; max: number | null; amount: string }[] | null;
  effective_from: string;
  created_at: string;
  who: string | null;
};

function describeShip(r: ShipRow) {
  if (r.mode === "flat") return `Flat ${fmt(Number(r.flat_amount), "money", r.currency)} per order`;
  if (r.mode === "actual") return `Actual carrier costs (default ${fmt(Number(r.flat_amount), "money", r.currency)})`;
  return `Rate table, ${r.table?.length ?? 0} rows (default ${fmt(Number(r.flat_amount), "money", r.currency)})`;
}

export async function ShippingTab() {
  const db = getDb();
  const [stores, currencies, rules, actuals] = await Promise.all([
    loadStores(),
    knownCurrencies(db),
    db.execute<ShipRow>(sql`select r.id, r.store_id, r.mode, r.flat_amount::text, r.currency, r."table", r.effective_from::text, r.created_at, u.username who
      from shipping_rules r left join users u on u.id = r.created_by order by r.effective_from desc, r.id desc`),
    db.execute<{ store_id: number; n: number; last_at: string | null }>(sql`select store_id, count(*)::int n, max(created_at) last_at from order_shipping_costs group by store_id`),
  ]);
  return (
    <div className="flex flex-col gap-5">
      {stores.map((s) => {
        const hist = rules.rows.filter((r) => r.store_id === s.id);
        const cur = inForceToday(hist);
        return (
          <section key={s.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{s.name}</h2>
              <span className="text-sm text-muted">{cur ? `Now: ${describeShip(cur)}` : "No shipping rule yet: shipping cost counts as 0"}</span>
            </div>
            <ActionForm action={createShippingRule} className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <input type="hidden" name="storeId" value={s.id} />
              <ShippingTableEditor />
              <Field label="Currency">
                <CurrencySelect currencies={currencies} value={s.currency} />
              </Field>
              <Field label="Effective from">
                <input type="date" name="effectiveFrom" defaultValue={today()} required className="input" />
              </Field>
              <SubmitButton>Add rule</SubmitButton>
            </ActionForm>
            {hist.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Effective from</th>
                      <th>Rule</th>
                      <th>Table</th>
                      <th>Added</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {hist.map((r) => (
                      <tr key={r.id}>
                        <td className="tabular">{r.effective_from}</td>
                        <td>{describeShip(r)}</td>
                        <td className="text-xs text-muted">
                          {r.mode === "table" &&
                            r.table?.map((t, i) => (
                              <div key={i}>
                                {t.country} · {t.basis === "weight" ? "g" : "items"} {t.min}–{t.max ?? "∞"} → {fmt(Number(t.amount), "money", r.currency)}
                              </div>
                            ))}
                        </td>
                        <td className="text-muted">
                          {stamp(r.created_at)} {r.who ? `· ${r.who}` : ""}
                        </td>
                        <td>
                          <StatusPill row={r} current={cur} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <section className="card p-4">
        <h2 className="font-semibold">Import actual shipping costs</h2>
        <p className="mt-0.5 max-w-prose text-xs text-muted">
          A carrier CSV with columns <code>order_name</code> (e.g. #1001), <code>cost</code>, <code>currency</code>, <code>carrier</code>. Imported costs override every rule for that order. Re-importing an
          order replaces its previous value.
        </p>
        <ActionForm action={importShippingActuals} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Store">
            <select name="storeId" required className="input" defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="CSV file">
            <input type="file" name="file" accept=".csv,text/csv" required className="input max-w-full py-1.5 file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium" />
          </Field>
          <SubmitButton>
            <Upload size={14} /> Import
          </SubmitButton>
        </ActionForm>
        <ul className="mt-3 text-xs text-muted">
          {stores.map((s) => {
            const a = actuals.rows.find((x) => x.store_id === s.id);
            return (
              <li key={s.id}>
                {s.name}: {a ? `${a.n.toLocaleString()} orders with an imported cost, last import ${a.last_at ? stamp(a.last_at) : "—"}` : "no imports yet"}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- handling

export async function HandlingTab() {
  const db = getDb();
  const [stores, currencies, rules] = await Promise.all([
    loadStores(),
    knownCurrencies(db),
    db.execute<{ id: number; store_id: number; per_order: string; per_item: string; currency: string; effective_from: string; created_at: string; who: string | null }>(sql`
      select r.id, r.store_id, r.per_order::text, r.per_item::text, r.currency, r.effective_from::text, r.created_at, u.username who
      from handling_rules r left join users u on u.id = r.created_by order by r.effective_from desc, r.id desc`),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-sm text-muted">Pick, pack and fulfilment fees: a fixed amount per order plus an amount per shipped item.</p>
      {stores.map((s) => {
        const hist = rules.rows.filter((r) => r.store_id === s.id);
        const cur = inForceToday(hist);
        return (
          <section key={s.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{s.name}</h2>
              <span className="text-sm text-muted">
                {cur ? `Now: ${fmt(Number(cur.per_order), "money", cur.currency)} per order + ${fmt(Number(cur.per_item), "money", cur.currency)} per item` : "No handling fees"}
              </span>
            </div>
            <ActionForm action={createHandlingRule} className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <input type="hidden" name="storeId" value={s.id} />
              <Field label="Per order">
                <input name="perOrder" inputMode="decimal" placeholder="0.00" className="input w-28" />
              </Field>
              <Field label="Per item">
                <input name="perItem" inputMode="decimal" placeholder="0.00" className="input w-28" />
              </Field>
              <Field label="Currency">
                <CurrencySelect currencies={currencies} value={s.currency} />
              </Field>
              <Field label="Effective from">
                <input type="date" name="effectiveFrom" defaultValue={today()} required className="input" />
              </Field>
              <SubmitButton>Add rule</SubmitButton>
            </ActionForm>
            {hist.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Effective from</th>
                      <th className="num">Per order</th>
                      <th className="num">Per item</th>
                      <th>Added</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {hist.map((r) => (
                      <tr key={r.id}>
                        <td className="tabular">{r.effective_from}</td>
                        <td className="num">{fmt(Number(r.per_order), "money", r.currency)}</td>
                        <td className="num">{fmt(Number(r.per_item), "money", r.currency)}</td>
                        <td className="text-muted">
                          {stamp(r.created_at)} {r.who ? `· ${r.who}` : ""}
                        </td>
                        <td>
                          <StatusPill row={r} current={cur} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- payment fees

export async function FeesTab() {
  const db = getDb();
  const [stores, currencies, rules, gateways] = await Promise.all([
    loadStores(),
    knownCurrencies(db),
    db.execute<{ id: number; store_id: number; gateway: string; percent: string; fixed: string; currency: string; effective_from: string; created_at: string; who: string | null }>(sql`
      select r.id, r.store_id, r.gateway, r.percent::text, r.fixed::text, r.currency, r.effective_from::text, r.created_at, u.username who
      from payment_fee_rules r left join users u on u.id = r.created_by order by r.gateway, r.effective_from desc, r.id desc`),
    db.execute<{ store_id: number; gateway: string; n: number }>(sql`select store_id, gateway, count(*)::int n from transactions group by 1, 2 order by 3 desc`),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-prose rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
        For <strong className="text-ink">Shopify Payments</strong> the actual processing fee from Shopify&apos;s payouts API is used whenever it is available; a rule here only fills in until the payout
        data arrives (or for stores without it). Other gateways (PayPal, cash on delivery, …) always use these rules. Each rule is percent of the transaction plus a fixed fee per transaction. “*” matches
        any gateway without its own rule.
      </div>
      {stores.map((s) => {
        const hist = rules.rows.filter((r) => r.store_id === s.id);
        const seen = gateways.rows.filter((g) => g.store_id === s.id);
        const byGateway = [...new Set(hist.map((r) => r.gateway))];
        return (
          <section key={s.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{s.name}</h2>
              <span className="text-xs text-muted">Gateways seen: {seen.length ? seen.map((g) => `${g.gateway} (${g.n})`).join(", ") : "none yet"}</span>
            </div>
            <ActionForm action={createPaymentFeeRule} className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <input type="hidden" name="storeId" value={s.id} />
              <Field label="Gateway">
                <input name="gateway" list={`gw-${s.id}`} required placeholder="* (any other)" className="input w-52" />
              </Field>
              <datalist id={`gw-${s.id}`}>
                <option value="*">any other gateway</option>
                {seen.map((g) => (
                  <option key={g.gateway} value={g.gateway} />
                ))}
              </datalist>
              <Field label="Percent">
                <input name="percent" inputMode="decimal" placeholder="2.9" className="input w-20" />
              </Field>
              <Field label="Fixed per txn">
                <input name="fixed" inputMode="decimal" placeholder="0.30" className="input w-24" />
              </Field>
              <Field label="Currency">
                <CurrencySelect currencies={currencies} value={s.currency} />
              </Field>
              <Field label="Effective from">
                <input type="date" name="effectiveFrom" defaultValue={today()} required className="input" />
              </Field>
              <SubmitButton>Add rule</SubmitButton>
            </ActionForm>
            {hist.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Gateway</th>
                      <th>Effective from</th>
                      <th className="num">Percent</th>
                      <th className="num">Fixed</th>
                      <th>Added</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {byGateway.flatMap((gw) => {
                      const rows = hist.filter((r) => r.gateway === gw);
                      const cur = inForceToday(rows);
                      return rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.gateway === "*" ? "* any other" : r.gateway}</td>
                          <td className="tabular">{r.effective_from}</td>
                          <td className="num">{Number(r.percent)}%</td>
                          <td className="num">{fmt(Number(r.fixed), "money", r.currency)}</td>
                          <td className="text-muted">
                            {stamp(r.created_at)} {r.who ? `· ${r.who}` : ""}
                          </td>
                          <td>
                            <StatusPill row={r} current={cur} />
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- audit

/** Compact JSON for the log, without bookkeeping fields. */
const OMIT = new Set(["createdAt", "createdBy", "created_at", "created_by"]);
const short = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = JSON.stringify(v, (k, val) => (OMIT.has(k) ? undefined : val));
  return s.length > 220 ? s.slice(0, 220) + "…" : s;
};

export async function CostLog() {
  const res = await getDb().execute<{ id: number; at: string; action: string; entity: string | null; entity_id: string | null; old_value: unknown; new_value: unknown; who: string | null }>(sql`
    select a.id, a.at, a.action, a.entity, a.entity_id, a.old_value, a.new_value, u.username who
    from audit_log a left join users u on u.id = a.user_id where a.action like 'cost.%' order by a.at desc limit 300`);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Old</th>
            <th>New</th>
          </tr>
        </thead>
        <tbody>
          {res.rows.map((r) => (
            <tr key={r.id}>
              <td className="tabular">{stamp(r.at)}</td>
              <td>{r.who ?? "system"}</td>
              <td>
                <span className="font-mono text-xs">{r.action}</span>
                {r.entity_id && <span className="text-muted"> #{r.entity_id}</span>}
              </td>
              <td className="max-w-xs !whitespace-normal break-all font-mono text-xs text-muted">{short(r.old_value)}</td>
              <td className="max-w-md !whitespace-normal break-all font-mono text-xs">{short(r.new_value)}</td>
            </tr>
          ))}
          {res.rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-muted">
                No cost changes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
