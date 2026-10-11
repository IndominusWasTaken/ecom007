import { requireUser } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { parseView, viewQuery, type SearchParams } from "@/lib/params";
import { pnlByPeriod, pnlByStore, type PnlLine } from "@/lib/reports";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { ExportLink } from "@/components/Delta";
import { Waterfall } from "@/components/charts/Charts";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import type { Num } from "@/lib/metrics";

export const metadata = { title: "Profit & loss" };

function Cell({ v, line, currency, bold, className }: { v: Num; line: PnlLine; currency: string; bold?: boolean; className?: string }) {
  return <td className={cn("num", bold && "font-semibold", v !== null && v < 0 && "text-neg", className)}>{fmt(v, line.format, currency)}</td>;
}

const PERIOD_LABEL = { day: "Day", week: "Week of", month: "Month" } as const;

export default async function PnlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const [stores, periods] = await Promise.all([
    pnlByStore(scope, view.range, view.currency),
    pnlByPeriod(scope, view.range, view.currency, view.granularity),
  ]);
  const t = stores.cols[stores.cols.length - 1].values;
  const v = (id: string) => t[id] ?? 0;
  const steps = [
    { label: "Total sales", value: v("total_sales"), total: true },
    { label: "Net taxes", value: -v("net_taxes") },
    { label: "Net revenue", value: v("net_revenue"), total: true },
    { label: "Adjusted COGS", value: -v("adjusted_cogs") },
    { label: "Gross profit", value: v("gross_profit"), total: true },
    { label: "Shipping cost", value: -v("shipping_cost") },
    { label: "Handling fees", value: -v("handling_fees") },
    { label: "Payment fees", value: -v("payment_fees") },
    { label: "Contribution margin", value: v("contribution_margin"), total: true },
    { label: "Blended ad spend", value: -v("blended_ad_spend") },
    { label: "Operating expenses", value: -v("operating_expenses") },
    { label: "Net profit", value: v("net_profit"), total: true },
    ...(stores.taxOn
      ? [
          { label: "Profit tax", value: -v("profit_tax") },
          { label: "Profit after tax", value: v("profit_after_tax"), total: true },
        ]
      : []),
  ];
  const qs = viewQuery(sp);
  const exportHref = (kind: string) => `/api/export/pnl?kind=${kind}${qs ? `&${qs}` : ""}`;
  const periodFmt = (d: string) =>
    view.granularity === "month"
      ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
      : new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Profit & loss" subtitle={<RangeNote view={view} />} view={view} showCompare={false} showGranularity />

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">From total sales to net profit · {scope.label}</h2>
        <Waterfall steps={steps} currency={view.currency} height={360} />
      </section>

      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{stores.cols.length > 1 ? "By store" : "Statement"}</h2>
          <ExportLink href={exportHref("stores")} />
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{view.currency}</th>
                {stores.cols.map((c) => (
                  <th key={c.key} className={cn("num text-right!", c.total && "border-l border-line text-ink")}>
                    {c.label}
                    {c.native && c.native !== view.currency && <span className="font-normal"> · native {c.native}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stores.lines.map((l) => (
                <tr key={l.id}>
                  <td className={cn(l.strong && "font-semibold", l.indent && "pl-6 text-muted")}>{l.label}</td>
                  {stores.cols.map((c) => (
                    <Cell key={c.key} v={c.values[l.id]} line={l} currency={view.currency} bold={c.total || l.strong} className={cn(c.total && "border-l border-line")} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stores.cols.some((c) => c.key === "unassigned") && (
          <p className="mt-2 text-xs text-muted">Unassigned is ad spend from campaigns not mapped to a store. It is counted only in the All stores total.</p>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">By {view.granularity}</h2>
          <ExportLink href={exportHref("periods")} />
        </div>
        <div className="card max-h-[640px] overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{PERIOD_LABEL[view.granularity]}</th>
                {periods.lines.map((l) => (
                  <th key={l.id} className="num text-right!">
                    {l.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.rows.map((r) => (
                <tr key={r.period}>
                  <td className="tabular">{periodFmt(r.period)}</td>
                  {periods.lines.map((l) => (
                    <Cell key={l.id} v={r.values[l.id]} line={l} currency={view.currency} bold={l.id === "net_profit"} />
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2">
                <td className="px-3 py-2 font-semibold">Total</td>
                {periods.lines.map((l) => (
                  <td key={l.id} className={cn("num px-3 py-2 font-semibold", (periods.total[l.id] ?? 0) < 0 && "text-neg")}>
                    {fmt(periods.total[l.id], l.format, view.currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        {view.granularity !== "day" && <p className="mt-2 text-xs text-muted">The first and last {view.granularity} may be partial: only days inside the range are counted.</p>}
      </section>
    </>
  );
}
