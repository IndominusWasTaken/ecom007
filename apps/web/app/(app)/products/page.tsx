import { Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { KEEP_KEYS, parseView, viewQuery, withParams, type SearchParams } from "@/lib/params";
import { PRODUCT_COLUMNS, filterAndSort, productTable } from "@/lib/reports";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { ExportLink } from "@/components/Delta";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import { ProductsTable, type Column, type Row } from "./ProductsTable";

export const metadata = { title: "Products" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const q = one(sp.q);
  const sort = one(sp.sort) || "netSales";
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const byVariant = one(sp.by) === "variant";

  const all = await productTable(scope.storeIds, view.range, view.currency);
  const rows = filterAndSort(all, q, sort, dir, byVariant) as Row[];
  const missing = all.reduce((n, p) => n + p.missingCostUnits, 0);
  const totals = rows.reduce(
    (t, r) => ({ units: t.units + r.units, netSales: t.netSales + r.netSales, cogs: t.cogs + r.cogs, refunded: t.refunded + r.refundedAmount }),
    { units: 0, netSales: 0, cogs: 0, refunded: 0 },
  );

  const cols: Column[] = PRODUCT_COLUMNS.map((c) => ({
    id: c.id,
    label: c.id === "title" && byVariant ? "Product — variant" : c.label,
    format: c.format,
    // clicking the active column flips the direction; a new column starts descending (A→Z for names)
    href: withParams("/products", sp, { sort: c.id, dir: sort === c.id ? (dir === "desc" ? "asc" : "desc") : c.id === "title" ? "asc" : "desc" }),
    active: sort === c.id ? dir : null,
  }));
  const keep = KEEP_KEYS.map((k) => [k, one(sp[k])] as const).filter(([, v]) => v);
  const qs = viewQuery(sp);
  const exportHref = `/api/export/products?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), ...(q ? { q } : {}), sort, dir, ...(byVariant ? { by: "variant" } : {}) })}`;
  const cur = view.currency;

  return (
    <>
      <PageHeader title="Products" subtitle={<RangeNote view={view} />} view={view} showCompare={false} />

      {missing > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <strong>COGS missing:</strong> {missing.toLocaleString()} units in this range were sold without a unit cost, so their margin is overstated.
          <a className="underline" href="/costs?missing=1">
            Add costs
          </a>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form action="/products" className="flex min-w-0 flex-1 items-center gap-2">
          {keep.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          {byVariant && <input type="hidden" name="by" value="variant" />}
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input className="input w-full pl-8!" type="search" name="q" defaultValue={q} placeholder="Search product, variant or SKU" />
          </div>
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
          {[
            ["product", "By product"],
            ["variant", "By variant"],
          ].map(([k, label]) => (
            <a
              key={k}
              href={withParams("/products", sp, { by: k === "variant" ? "variant" : null })}
              className={cn("rounded-md px-2.5 py-1", (k === "variant") === byVariant ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink")}
            >
              {label}
            </a>
          ))}
        </div>
        <ExportLink href={exportHref} />
      </div>

      <div className="card overflow-x-auto">
        {rows.length ? (
          <ProductsTable rows={rows} cols={cols} currency={cur} showStore={scope.storeIds.length > 1} expandable={!byVariant} />
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted">{q ? `No product matches “${q}”.` : "No products sold or refunded in this range."}</p>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {rows.length} {byVariant ? "variants" : "products"} · {fmt(totals.units, "number")} units · {fmt(totals.netSales, "money", cur)} net sales ·{" "}
        {fmt(totals.netSales - totals.cogs, "money", cur)} gross margin · {fmt(totals.refunded, "money", cur)} refunded. Net sales are ex tax, after discounts, by
        order date; refunds are by refund date (ex tax). COGS uses the unit cost in force on the order date. Refund rate = refunded ÷ net sales.
      </p>
    </>
  );
}
