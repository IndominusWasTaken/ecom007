"use client";
import { useState } from "react";
import { CATEGORIES, CYCLES, STATUSES } from "./constants";

export type StoreOpt = { id: number; name: string; regionId: number; regionName: string };

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** Scope (store / region / shared) and how a shared cost is split, with per-store percents for "fixed". */
export function ScopeFields({
  stores,
  initial,
}: {
  stores: StoreOpt[];
  initial?: { scope: string; storeId: number | null; regionId: number | null; allocation: string; percents: Record<string, number> | null };
}) {
  const [scope, setScope] = useState(initial?.scope ?? "shared");
  const [allocation, setAllocation] = useState(initial?.allocation ?? "equal");
  const [regionId, setRegionId] = useState(String(initial?.regionId ?? stores[0]?.regionId ?? ""));
  const regions = [...new Map(stores.map((s) => [s.regionId, s.regionName])).entries()];
  const inScope = scope === "region" ? stores.filter((s) => String(s.regionId) === regionId) : stores;
  return (
    <>
      <Field label="Scope">
        <select name="scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="shared">Shared (all stores)</option>
          <option value="region">Region</option>
          <option value="store">One store</option>
        </select>
      </Field>
      {scope === "store" && (
        <Field label="Store">
          <select name="storeId" className="input" defaultValue={initial?.storeId ?? stores[0]?.id}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {scope === "region" && (
        <Field label="Region">
          <select name="regionId" className="input" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            {regions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {scope !== "store" && (
        <Field label="Split between stores">
          <select name="allocation" className="input" value={allocation} onChange={(e) => setAllocation(e.target.value)}>
            <option value="equal">Equally</option>
            <option value="revenue">By revenue share (last 30 days)</option>
            <option value="fixed">Fixed %</option>
          </select>
        </Field>
      )}
      {scope !== "store" && allocation === "fixed" && (
        <div className="flex basis-full flex-wrap gap-2">
          {inScope.map((s) => (
            <Field key={s.id} label={`${s.name} %`}>
              <input name={`pct_${s.id}`} inputMode="decimal" defaultValue={initial?.percents?.[String(s.id)] ?? ""} placeholder="0" className="input w-24" />
            </Field>
          ))}
        </div>
      )}
    </>
  );
}

export interface SubInitial {
  id: number;
  name: string;
  vendor: string | null;
  category: string;
  amount: string;
  currency: string;
  cycle: string;
  everyNMonths: number | null;
  anchorDate: string;
  startDate: string | null;
  endDate: string | null;
  scope: string;
  storeId: number | null;
  regionId: number | null;
  allocation: string;
  percents: Record<string, number> | null;
  status: string;
  paymentMethod: string | null;
  manageUrl: string | null;
  notes: string | null;
  countsAsAdSpend: boolean;
  reminderDays: number | null;
  domain: string | null;
  domainExpiry: string | null;
}

/** All fields of the subscription form (create when `initial` is absent, edit otherwise). */
export function SubscriptionFields({ stores, currencies, today, initial }: { stores: StoreOpt[]; currencies: string[]; today: string; initial?: SubInitial }) {
  const [cycle, setCycle] = useState(initial?.cycle ?? "monthly");
  const [category, setCategory] = useState(initial?.category ?? "tools");
  return (
    <div className="flex flex-wrap items-end gap-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Name" className="w-full sm:w-56">
        <input name="name" required defaultValue={initial?.name} className="input" placeholder="e.g. Shopify Basic" />
      </Field>
      <Field label="Vendor">
        <input name="vendor" defaultValue={initial?.vendor ?? ""} className="input w-40" />
      </Field>
      <Field label="Category">
        <select name="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount">
        <input name="amount" required inputMode="decimal" defaultValue={initial ? Number(initial.amount).toString() : ""} placeholder="0.00" className="input w-28" />
      </Field>
      <Field label="Currency">
        <select name="currency" defaultValue={initial?.currency ?? "USD"} className="input">
          {currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Billing cycle">
        <select name="cycle" className="input" value={cycle} onChange={(e) => setCycle(e.target.value)}>
          {CYCLES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      {cycle === "every_n_months" && (
        <Field label="N months">
          <input name="everyNMonths" inputMode="numeric" defaultValue={initial?.everyNMonths ?? 3} className="input w-20" />
        </Field>
      )}
      <Field label={cycle === "one_off" ? "Charge date" : "A charge date (anchor)"}>
        <input type="date" name="anchorDate" required defaultValue={initial?.anchorDate ?? today} className="input" />
      </Field>
      {cycle !== "one_off" && (
        <Field label="Started (first charge on/after)">
          <input type="date" name="startDate" defaultValue={initial ? (initial.startDate ?? "") : today} className="input" />
        </Field>
      )}
      {cycle !== "one_off" && (
        <Field label="Ends (optional)">
          <input type="date" name="endDate" defaultValue={initial?.endDate ?? ""} className="input" />
        </Field>
      )}
      <Field label="Status">
        <select name="status" defaultValue={initial?.status ?? "active"} className="input">
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <ScopeFields stores={stores} initial={initial ? { scope: initial.scope, storeId: initial.storeId, regionId: initial.regionId, allocation: initial.allocation, percents: initial.percents } : undefined} />
      <Field label="Payment method">
        <input name="paymentMethod" defaultValue={initial?.paymentMethod ?? ""} placeholder="Visa ··4242" className="input w-36" />
      </Field>
      <Field label="Manage / billing link" className="w-full sm:w-64">
        <input name="manageUrl" type="url" defaultValue={initial?.manageUrl ?? ""} placeholder="https://" className="input" />
      </Field>
      <Field label="Reminder days before">
        <input name="reminderDays" inputMode="numeric" defaultValue={initial?.reminderDays ?? ""} placeholder="auto" className="input w-24" />
      </Field>
      {category === "domains" && (
        <>
          <Field label="Domain">
            <input name="domain" defaultValue={initial?.domain ?? ""} placeholder="example.com" className="input w-44" />
          </Field>
          <Field label="Domain expiry (if not looked up)">
            <input type="date" name="domainExpiry" defaultValue={initial?.domainExpiry ?? ""} className="input" />
          </Field>
        </>
      )}
      <Field label="Notes" className="w-full sm:w-72">
        <input name="notes" defaultValue={initial?.notes ?? ""} className="input" />
      </Field>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="countsAsAdSpend" defaultChecked={initial?.countsAsAdSpend} /> Counts as ad spend
      </label>
    </div>
  );
}
