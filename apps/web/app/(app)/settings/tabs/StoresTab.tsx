import { ArrowDown, ArrowUp } from "lucide-react";
import { HISTORY_MONTHS } from "@ecom/core/config";
import { getDb, regions, stores } from "@ecom/db";
import { addStore, createRegion, moveRegion, renameRegion, updateStore } from "../actions";
import { ActionForm, Submit } from "../ui";
import { Empty, Field, Section, TimeZoneList } from "../Section";
import { statusPill, when } from "../format";
import { cn } from "@/lib/cn";

export async function StoresTab() {
  const db = getDb();
  const [regionRows, storeRows] = await Promise.all([db.select().from(regions).orderBy(regions.sortOrder, regions.name), db.select().from(stores).orderBy(stores.name)]);
  const counts = new Map<number, number>();
  for (const s of storeRows) counts.set(s.regionId, (counts.get(s.regionId) ?? 0) + 1);

  return (
    <>
      <TimeZoneList />
      <Section title="Regions" description="Regions group stores in the scope switcher and on the Regions page. Order here is the order everywhere.">
        <div className="card mb-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Code</th>
                <th className="num">Stores</th>
              </tr>
            </thead>
            <tbody>
              {regionRows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <div className="flex gap-1">
                      <form action={moveRegion.bind(null, r.id, -1)}>
                        <button className="btn btn-sm" disabled={i === 0} aria-label={`Move ${r.name} up`}>
                          <ArrowUp size={13} />
                        </button>
                      </form>
                      <form action={moveRegion.bind(null, r.id, 1)}>
                        <button className="btn btn-sm" disabled={i === regionRows.length - 1} aria-label={`Move ${r.name} down`}>
                          <ArrowDown size={13} />
                        </button>
                      </form>
                    </div>
                  </td>
                  <td>
                    <ActionForm action={renameRegion} inline>
                      <input type="hidden" name="id" value={r.id} />
                      <input name="name" defaultValue={r.name} className="input h-8 w-40" aria-label="Region name" required />
                      <Submit className="btn-sm">Rename</Submit>
                    </ActionForm>
                  </td>
                  <td className="font-mono text-xs text-muted">{r.code}</td>
                  <td className="num">{counts.get(r.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ActionForm action={createRegion} reset className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="region-name">
              New region
            </label>
            <input id="region-name" name="name" className="input w-44" placeholder="Germany" required />
          </div>
          <div>
            <label className="label" htmlFor="region-code">
              Code
            </label>
            <input id="region-code" name="code" className="input w-24" placeholder="de" required pattern="[a-zA-Z0-9\-]{1,16}" />
          </div>
          <Submit>Add region</Submit>
        </ActionForm>
      </Section>

      <Section
        title="Stores"
        description="Currency, time zone and the tax setting come from Shopify on the first sync. Inactive stores are hidden from scopes and stop syncing; their data is kept."
      >
        {storeRows.length === 0 && <Empty>No stores yet. Add one below.</Empty>}
        <div className="grid gap-3">
          {storeRows.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="h-3 w-3 rounded-full border border-line" style={{ background: s.color ?? "var(--muted)" }} />
                <h3 className="font-semibold">{s.name}</h3>
                <span className="font-mono text-xs text-muted">{s.shopDomain}</span>
                {!s.active && <span className="pill bg-surface-2 text-muted">Inactive</span>}
                <span className={cn("pill", s.historyLoadedAt ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn")} title={when(s.historyLoadedAt)}>
                  {s.historyLoadedAt ? "History loaded" : "History loading"}
                </span>
                <span className={cn("pill", statusPill(s.sessionsStatus === "ok" ? "ok" : s.sessionsStatus === "not_connected" ? "error" : null))}>Sessions: {s.sessionsStatus.replace("_", " ")}</span>
                {s.shopifyPlan && <span className="pill bg-surface-2 text-muted">{s.shopifyPlan}</span>}
              </div>
              <ActionForm action={updateStore}>
                <input type="hidden" name="id" value={s.id} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Name">
                    <input name="name" defaultValue={s.name} className="input w-full" required />
                  </Field>
                  <Field label="Region">
                    <select name="regionId" defaultValue={s.regionId} className="input w-full">
                      {regionRows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Currency">
                    <input name="currency" defaultValue={s.currency} className="input w-full uppercase" maxLength={3} required />
                  </Field>
                  <Field label="Time zone">
                    <input name="timeZone" defaultValue={s.timeZone} className="input w-full" list="tz-list" required />
                  </Field>
                  <Field label={`History from (max ${HISTORY_MONTHS} months)`}>
                    <input name="historyFrom" type="date" defaultValue={s.historyFrom ?? ""} className="input w-full" />
                  </Field>
                  <Field label="Color">
                    <input name="color" type="color" defaultValue={s.color ?? "#4f46e5"} className="input h-9 w-full p-1" />
                  </Field>
                  <div className="flex flex-col justify-end gap-1.5 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" name="pricesIncludeTax" defaultChecked={s.pricesIncludeTax} className="h-4 w-4" /> Prices include tax
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" name="active" defaultChecked={s.active} className="h-4 w-4" /> Active
                    </label>
                  </div>
                  <div className="flex items-end">
                    <Submit>Save store</Submit>
                  </div>
                </div>
              </ActionForm>
              <p className="mt-2 text-xs text-muted">
                History loaded {when(s.historyLoadedAt)} · Credentials and sync under{" "}
                <a href="/settings?tab=connections" className="underline">
                  Connections
                </a>
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Add store"
        description={
          <>
            Create an app for the store in the Shopify Dev Dashboard (same organization as the store) with read access to orders, products, inventory, reports and payments, install it, then paste its
            Client ID and Client secret. The store appears in every scope switcher and the P&amp;L automatically; history loads in the background.
          </>
        }
      >
        {regionRows.length === 0 ? (
          <Empty>Add a region first.</Empty>
        ) : (
          <ActionForm action={addStore} reset className="card p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Store name">
                <input name="name" className="input w-full" placeholder="Glow DE" required />
              </Field>
              <Field label="Region">
                <select name="regionId" className="input w-full" required>
                  {regionRows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shop domain">
                <input name="shopDomain" className="input w-full" placeholder="your-store.myshopify.com" required autoComplete="off" />
              </Field>
              <Field label="History from (optional)">
                <input name="historyFrom" type="date" className="input w-full" />
              </Field>
              <Field label="Client ID">
                <input name="clientId" className="input w-full" required autoComplete="off" spellCheck={false} />
              </Field>
              <Field label="Client secret">
                <input name="clientSecret" type="password" className="input w-full" required autoComplete="new-password" />
              </Field>
              <Field label="Currency (until first sync)">
                <input name="currency" defaultValue="USD" className="input w-full uppercase" maxLength={3} />
              </Field>
              <Field label="Time zone (until first sync)">
                <input name="timeZone" defaultValue="Europe/Sofia" className="input w-full" list="tz-list" />
              </Field>
              <Field label="Color">
                <input name="color" type="color" defaultValue="#16a34a" className="input h-9 w-full p-1" />
              </Field>
              <div className="flex items-end pb-2 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" name="pricesIncludeTax" className="h-4 w-4" /> Prices include tax
                </label>
              </div>
              <div className="flex items-end sm:col-span-2">
                <Submit variant="primary">Add store and load history</Submit>
              </div>
            </div>
          </ActionForm>
        )}
      </Section>
    </>
  );
}
