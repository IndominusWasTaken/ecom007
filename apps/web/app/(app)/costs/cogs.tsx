import Link from "next/link";
import { AlertTriangle, Download, Upload, Wand2 } from "lucide-react";
import { addDays } from "@ecom/core/dates";
import { getDb, sql } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { knownCurrencies, stamp, today } from "@/lib/forms";
import { withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/cn";
import { createVariantCost, importCostsCsv, prefillFromShopify, setFallback } from "./actions";
import { ExpandableRow } from "./client";

const MAX_ROWS = 300;

type CostRow = {
  id: number;
  store_id: number;
  sku: string | null;
  variant_shopify_id: string | null;
  cost: string;
  currency: string;
  effective_from: string;
  source: string;
  created_at: string;
  who: string | null;
};

interface GridRow {
  key: string;
  storeId: number;
  variantId: string | null;
  sku: string | null;
  product: string;
  variant: string;
  shopifyCost: number | null;
  history: CostRow[];
  missingUnits: number;
  missingRevenue: number;
  orphan: boolean; // sold, but not in the synced catalog
}

export async function CogsTab({ currency, q, store, missing, sp }: { currency: "USD" | "EUR"; q: string; store: string; missing: boolean; sp: SearchParams }) {
  const db = getDb();
  const t = today();
  const fxCol = currency === "EUR" ? sql`o.fx_to_eur` : sql`o.fx_to_usd`;
  const [storesRes, variantsRes, costsRes, missingRes, recentRes, currencies] = await Promise.all([
    db.execute<{ id: number; name: string; currency: string; cogs_fallback_percent: string | null }>(
      sql`select id, name, currency, cogs_fallback_percent::text from stores order by id`,
    ),
    db.execute<{ store_id: number; shopify_id: string; sku: string | null; vtitle: string | null; ptitle: string | null; shopify_cost: string | null }>(sql`
      select v.store_id, v.shopify_id, v.sku, v.title vtitle, p.title ptitle, v.shopify_cost::text
      from variants v left join products p on p.store_id = v.store_id and (p.id = v.product_id or p.shopify_id = v.product_shopify_id)
      order by v.store_id, p.title, v.title`),
    db.execute<CostRow>(sql`
      select c.id, c.store_id, c.sku, c.variant_shopify_id, c.cost::text, c.currency, c.effective_from::text, c.source, c.created_at, u.username who
      from variant_costs c left join users u on u.id = c.created_by order by c.effective_from desc, c.id desc`),
    db.execute<{ store_id: number; variant_shopify_id: string | null; sku: string | null; title: string; vtitle: string | null; units: number; rev: number }>(sql`
      select l.store_id, l.variant_shopify_id, max(l.sku) sku, max(l.title) title, max(l.variant_title) vtitle,
        sum(l.quantity)::int units, sum((l.gross_ex - l.discount_ex) * ${fxCol})::float8 rev
      from order_lines l join orders o on o.id = l.order_id
      where l.cost_source = 'missing' and not o.test
      group by l.store_id, l.variant_shopify_id, lower(l.sku)`),
    // last 30 days, for the warning card
    db.execute<{ store_id: number; units: number; rev: number; skus: number; fb_units: number }>(sql`
      select s.id store_id,
        coalesce((select sum(cogs_missing_units) from daily_store_metrics m where m.store_id = s.id and m.currency = ${currency} and m.date between ${addDays(t, -30)} and ${t}), 0)::float8 units,
        coalesce((select sum(cogs_missing_revenue) from daily_store_metrics m where m.store_id = s.id and m.currency = ${currency} and m.date between ${addDays(t, -30)} and ${t}), 0)::float8 rev,
        (select count(distinct coalesce(l.variant_shopify_id, lower(l.sku))) from order_lines l join orders o on o.id = l.order_id
          where l.store_id = s.id and l.cost_source = 'missing' and not o.test and o.local_date >= ${addDays(t, -30)})::int skus,
        coalesce((select sum(l.quantity) from order_lines l join orders o on o.id = l.order_id
          where l.store_id = s.id and l.cost_source = 'fallback' and not o.test and o.local_date >= ${addDays(t, -30)}), 0)::float8 fb_units
      from stores s order by s.id`),
    knownCurrencies(db),
  ]);
  const stores = storesRes.rows;
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const fallback = new Map(stores.map((s) => [s.id, s.cogs_fallback_percent ? Number(s.cogs_fallback_percent) : null]));
  const storeCcy = new Map(stores.map((s) => [s.id, s.currency]));

  // one grid row per catalog variant, plus sold-but-uncatalogued SKUs
  const rows: GridRow[] = variantsRes.rows.map((v) => ({
    key: `${v.store_id}:${v.shopify_id}`,
    storeId: v.store_id,
    variantId: v.shopify_id,
    sku: v.sku,
    product: v.ptitle ?? "—",
    variant: v.vtitle ?? "",
    shopifyCost: v.shopify_cost === null ? null : Number(v.shopify_cost),
    history: [],
    missingUnits: 0,
    missingRevenue: 0,
    orphan: false,
  }));
  const byVariant = new Map(rows.map((r) => [r.key, r]));
  const bySku = new Map(rows.filter((r) => r.sku).map((r) => [`${r.storeId}:${r.sku!.toLowerCase()}`, r]));
  for (const m of missingRes.rows) {
    let r = (m.variant_shopify_id && byVariant.get(`${m.store_id}:${m.variant_shopify_id}`)) || (m.sku ? bySku.get(`${m.store_id}:${m.sku.toLowerCase()}`) : undefined);
    if (!r) {
      r = { key: `${m.store_id}:orphan:${m.variant_shopify_id ?? m.sku}`, storeId: m.store_id, variantId: m.variant_shopify_id, sku: m.sku, product: m.title, variant: m.vtitle ?? "", shopifyCost: null, history: [], missingUnits: 0, missingRevenue: 0, orphan: true };
      rows.push(r);
    }
    r.missingUnits += m.units;
    r.missingRevenue += m.rev;
  }
  for (const c of costsRes.rows) {
    const seen = new Set<GridRow>();
    for (const r of [c.variant_shopify_id && byVariant.get(`${c.store_id}:${c.variant_shopify_id}`), c.sku && bySku.get(`${c.store_id}:${c.sku.toLowerCase()}`)]) {
      if (r && !seen.has(r)) {
        seen.add(r);
        r.history.push(c);
      }
    }
    for (const r of rows) if (r.orphan && r.storeId === c.store_id && !seen.has(r) && c.sku && r.sku?.toLowerCase() === c.sku.toLowerCase()) r.history.push(c);
  }

  const needle = q.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!store || String(r.storeId) === store) &&
      (!missing || r.missingUnits > 0) &&
      (!needle || [r.sku, r.product, r.variant].some((s) => s?.toLowerCase().includes(needle))),
  );
  if (missing) filtered.sort((a, b) => b.missingRevenue - a.missingRevenue);
  const shown = filtered.slice(0, MAX_ROWS);
  const colSpan = missing ? 11 : 9;

  return (
    <div className="flex flex-col gap-5">
      <FallbackCards stores={stores} recent={recentRes.rows} currency={currency} />

      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">Bulk tools</h2>
            <p className="mt-0.5 max-w-prose text-xs text-muted">
              Typed costs always win over Shopify&apos;s “cost per item”. Prefill copies Shopify&apos;s value into a typed row (from the store&apos;s first order) for variants that have none yet; it never touches existing rows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={prefillFromShopify} confirm="Copy Shopify cost per item into typed costs for variants that have no typed cost?">
              <SubmitButton variant="plain">
                <Wand2 size={14} /> Prefill from Shopify
              </SubmitButton>
            </ActionForm>
            <a className="btn" href="/api/costs/export?kind=current">
              <Download size={14} /> Export current costs
            </a>
            <a className="btn" href="/api/costs/export?kind=template">
              <Download size={14} /> CSV template
            </a>
          </div>
        </div>
        <ActionForm action={importCostsCsv} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <label className="flex min-w-0 flex-col">
            <span className="label">Import costs CSV (store, sku, cost, currency, effective_from)</span>
            <input type="file" name="file" accept=".csv,text/csv" required className="input max-w-full py-1.5 file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium" />
          </label>
          <SubmitButton>
            <Upload size={14} /> Import
          </SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3">
        <form method="get" action="/costs" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="cogs" />
          {sp.cur && <input type="hidden" name="cur" value={String(sp.cur)} />}
          <label className="flex w-full flex-col sm:w-72">
            <span className="label">Search</span>
            <input name="q" defaultValue={q} placeholder="SKU, product or variant" className="input" />
          </label>
          <label className="flex flex-col">
            <span className="label">Store</span>
            <select name="store" defaultValue={store} className="input">
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="missing" value="1" defaultChecked={missing} /> Sold without a cost
          </label>
          <button className="btn">Apply</button>
          {(q || store || missing) && (
            <Link className="btn" href={withParams("/costs", { cur: sp.cur }, { tab: "cogs" })}>
              Clear
            </Link>
          )}
        </form>
        {missing && (
          <p className="text-xs text-muted">
            SKUs on order lines that had no cost at the last rebuild (all history), largest revenue first. Revenue is net of discounts, ex tax, in {currency}.
          </p>
        )}
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Product</th>
                <th>Variant</th>
                <th>SKU</th>
                <th className="num">Shopify cost</th>
                <th className="num">Typed cost now</th>
                <th>Since</th>
                <th>Source in use</th>
                {missing && <th className="num">Units w/o cost</th>}
                {missing && <th className="num">Revenue affected</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const current = r.history.find((h) => h.effective_from <= t) ?? null;
                const fb = fallback.get(r.storeId) ?? null;
                const source = current ? "typed" : r.shopifyCost && r.shopifyCost > 0 ? "shopify" : fb ? "fallback" : "missing";
                const ccy = storeCcy.get(r.storeId) ?? "USD";
                return (
                  <ExpandableRow
                    key={r.key}
                    colSpan={colSpan}
                    label={`History (${r.history.length})`}
                    cells={
                      <>
                        <td>{storeName.get(r.storeId)}</td>
                        <td className="max-w-[16rem] truncate" title={r.product}>
                          {r.product}
                          {r.orphan && <span className="pill ml-1.5 bg-surface-2 text-muted">not in catalog</span>}
                        </td>
                        <td className="max-w-[10rem] truncate" title={r.variant}>
                          {r.variant}
                        </td>
                        <td className="font-mono text-xs">{r.sku ?? "—"}</td>
                        <td className="num">{r.shopifyCost !== null ? fmt(r.shopifyCost, "money", ccy) : "—"}</td>
                        <td className="num">{current ? fmt(Number(current.cost), "money", current.currency) : "—"}</td>
                        <td className="tabular text-muted">{current?.effective_from ?? ""}</td>
                        <td>
                          <SourcePill source={source} fb={fb} />
                        </td>
                        {missing && <td className="num">{r.missingUnits.toLocaleString()}</td>}
                        {missing && <td className="num">{fmt(r.missingRevenue, "money", currency)}</td>}
                      </>
                    }
                    detail={<CostDetail row={r} storeCurrency={ccy} currencies={currencies} />}
                  />
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="py-8 text-center text-muted">
                    {missing ? "No SKUs sold without a cost." : "No variants match."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > MAX_ROWS && <p className="text-xs text-muted">Showing the first {MAX_ROWS} of {filtered.length}. Narrow the search to see more.</p>}
      </section>
    </div>
  );
}

function SourcePill({ source, fb }: { source: string; fb: number | null }) {
  const cls = {
    typed: "bg-accent-soft text-accent",
    shopify: "bg-surface-2 text-ink",
    fallback: "bg-warn-soft text-warn",
    missing: "bg-neg-soft text-neg",
  }[source];
  const label = { typed: "Typed", shopify: "Shopify cost", fallback: `Fallback ${fb ?? ""}%`, missing: "Missing" }[source];
  return <span className={cn("pill", cls)}>{label}</span>;
}

function CostDetail({ row, storeCurrency, currencies }: { row: GridRow; storeCurrency: string; currencies: string[] }) {
  const t = today();
  const current = row.history.find((h) => h.effective_from <= t);
  return (
    <div className="flex flex-col gap-4 py-2 lg:flex-row lg:items-start">
      <ActionForm action={createVariantCost} className="flex flex-wrap items-end gap-2 lg:w-[26rem] lg:shrink-0">
        <input type="hidden" name="storeId" value={row.storeId} />
        <input type="hidden" name="sku" value={row.sku ?? ""} />
        <input type="hidden" name="variantShopifyId" value={row.variantId ?? ""} />
        <p className="basis-full text-xs font-medium">Set a new cost (adds a dated row; to fix a mistake, add a corrected row with the same date)</p>
        <label className="flex flex-col">
          <span className="label">Cost per unit</span>
          <input name="cost" required inputMode="decimal" placeholder="0.00" className="input w-24" />
        </label>
        <label className="flex flex-col">
          <span className="label">Currency</span>
          <select name="currency" defaultValue={current?.currency ?? storeCurrency} className="input">
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label">Effective from</span>
          <input type="date" name="effectiveFrom" defaultValue={t} required className="input" />
        </label>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
      <div className="min-w-0 flex-1 overflow-x-auto">
        {row.history.length === 0 ? (
          <p className="text-xs text-muted">No typed cost yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Effective from</th>
                <th className="num">Cost</th>
                <th>Source</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {row.history.map((h) => (
                <tr key={h.id}>
                  <td className="tabular">{h.effective_from}</td>
                  <td className="num">{fmt(Number(h.cost), "money", h.currency)}</td>
                  <td className="text-muted">{h.source}</td>
                  <td className="text-muted">
                    {stamp(h.created_at)} {h.who ? `· ${h.who}` : ""}
                  </td>
                  <td>{h === current ? <span className="pill bg-accent-soft text-accent">in force</span> : h.effective_from > t ? <span className="pill bg-surface text-muted">scheduled</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FallbackCards({
  stores,
  recent,
  currency,
}: {
  stores: { id: number; name: string; currency: string; cogs_fallback_percent: string | null }[];
  recent: { store_id: number; units: number; rev: number; skus: number; fb_units: number }[];
  currency: "USD" | "EUR";
}) {
  return (
    <section className="grid gap-3 md:grid-cols-2">
      {stores.map((s) => {
        const r = recent.find((x) => x.store_id === s.id);
        const warn = (r?.units ?? 0) > 0;
        return (
          <div key={s.id} className={cn("card p-4", warn && "border-warn/40")}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{s.name}</h3>
              <span className="text-xs text-muted">last 30 days</span>
            </div>
            {warn ? (
              <p className="mt-2 flex gap-2 text-sm text-warn">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {r!.skus} SKU{r!.skus === 1 ? "" : "s"} sold without a cost: {r!.units.toLocaleString()} units on {fmt(r!.rev, "money", currency)} of revenue.{" "}
                  <Link className="underline" href={`/costs?tab=cogs&missing=1&store=${s.id}`}>
                    Show them
                  </Link>
                </span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">Every unit sold has a cost.</p>
            )}
            {(r?.fb_units ?? 0) > 0 && <p className="mt-1 text-xs text-muted">{r!.fb_units.toLocaleString()} units were costed with the % fallback.</p>}
            <ActionForm action={setFallback} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="storeId" value={s.id} />
              <label htmlFor={`fb-${s.id}`} className="label basis-full">
                Missing-cost fallback: % of the unit price, used only when a SKU has no cost at all (empty = off)
              </label>
              <input id={`fb-${s.id}`} name="percent" defaultValue={s.cogs_fallback_percent ? Number(s.cogs_fallback_percent).toString() : ""} inputMode="decimal" placeholder="off" className="input w-28" />
              <SubmitButton variant="plain">Save</SubmitButton>
            </ActionForm>
          </div>
        );
      })}
    </section>
  );
}
