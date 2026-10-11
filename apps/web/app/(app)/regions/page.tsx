import { requireUser } from "@/lib/auth";
import { scopeFor, storesAndRegions } from "@/lib/data";
import { metricBundle, metricMeta, type MetricBundle } from "@/lib/metrics";
import { parseView, type SearchParams } from "@/lib/params";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { Delta } from "@/components/Delta";
import { TimeSeries } from "@/components/charts/Charts";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Regions" };

const ROWS = [
  "total_sales",
  "orders",
  "aov",
  "new_customers_pct",
  "sessions",
  "conversion_rate",
  "blended_ad_spend",
  "blended_roas",
  "mer",
  "ncpa",
  "adjusted_cogs",
  "contribution_margin",
  "operating_expenses",
  "net_profit",
  "net_margin",
];

interface Col {
  key: string;
  label: string;
  native: string;
  bundle: MetricBundle;
  combined?: boolean;
}

export default async function RegionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const view = parseView(await searchParams);
  const rows = (await storesAndRegions()).filter((r) => r.active);

  // every active region (a new one appears automatically), each with its stores' native currencies
  const regions = new Map<string, { name: string; currencies: Set<string> }>();
  for (const r of rows) {
    const g = regions.get(r.region_code) ?? { name: r.region_name, currencies: new Set<string>() };
    g.currencies.add(r.currency);
    regions.set(r.region_code, g);
  }

  const load = async (key: string) => metricBundle(await scopeFor(key), view.range, view.compare, view.currency, view.granularity);
  const [combined, ...perRegion] = await Promise.all([load("all"), ...[...regions.keys()].map((code) => load(`region:${code}`))]);
  const cols: Col[] = [
    ...[...regions.entries()].map(([code, g], i) => ({ key: code, label: g.name, native: [...g.currencies].join(" + "), bundle: perRegion[i] })),
    { key: "all", label: "Combined", native: [...new Set(rows.map((r) => r.currency))].join(" + "), bundle: combined, combined: true },
  ];
  const meta = new Map(metricMeta().map((m) => [m.id, m]));
  const series = cols.filter((c) => !c.combined).map((c) => ({ name: c.label, points: c.bundle.series.net_profit }));

  return (
    <>
      <PageHeader title="Regions" subtitle={<RangeNote view={view} />} view={view} showScope={false} showGranularity />

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Metric</th>
              {cols.map((c) => (
                <th key={c.key} className={cn("num text-right!", c.combined && "border-l border-line")}>
                  <div className="text-ink">{c.label}</div>
                  <div className="font-normal">native {c.native} · shown in {view.currency}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((id) => {
              const m = meta.get(id)!;
              const strong = id === "net_profit" || id === "total_sales";
              return (
                <tr key={id}>
                  <td className={cn(strong && "font-semibold")} title={m.formula}>
                    {m.label}
                  </td>
                  {cols.map((c) => {
                    const v = c.bundle.current[id];
                    const off = m.source === "shopify-sessions" && !c.bundle.sessionsOk;
                    return (
                      <td key={c.key} className={cn("num", strong && "font-semibold", c.combined && "border-l border-line", m.format === "money" && v !== null && v < 0 && "text-neg")}>
                        {off ? <span className="text-muted">Not connected</span> : fmt(v, m.format, view.currency)}
                        {view.compare && !off && <Delta change={c.bundle.changes[id]} higherIsBetter={m.higherIsBetter} className="ml-2" />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Every column is converted to {view.currency} at each order&apos;s and ad day&apos;s exchange rate. Combined is the All stores scope, so it also includes
        ad spend from campaigns not mapped to any store (Unassigned) — that is why it can be lower than the sum of the regions&apos; net profit.
        {view.compare && <> Changes compare with {view.compare.from} → {view.compare.to}.</>}
      </p>

      <section className="card mt-5 p-4">
        <h2 className="mb-2 text-sm font-semibold">Net profit over time by region</h2>
        <TimeSeries series={series} format="money" currency={view.currency} kind={view.granularity === "day" ? "line" : "bar"} />
      </section>
    </>
  );
}
