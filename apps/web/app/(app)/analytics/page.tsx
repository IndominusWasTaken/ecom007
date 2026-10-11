import { PlugZap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { chartNotesIn, scopeFor } from "@/lib/data";
import { metricBundle, metricMeta, type MetricBundle } from "@/lib/metrics";
import { parseView, type SearchParams } from "@/lib/params";
import { salesByChannel, topProducts } from "@/lib/reports";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { Delta } from "@/components/Delta";
import { Funnel, HBar, TimeSeries, type Note, type Series } from "@/components/charts/Charts";
import { fmt, type Fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Store analytics" };

/** Shopify's "Sales breakdown" rows, with our labels mapped to theirs. */
const BREAKDOWN: [string, string][] = [
  ["gross_sales", "Gross sales"],
  ["discounts", "Discounts"],
  ["sales_reversals", "Returns"],
  ["net_sales", "Net sales"],
  ["shipping_charges", "Shipping charges"],
  ["return_fees", "Return fees"],
  ["net_taxes", "Taxes"],
  ["total_sales", "Total sales"],
];
/** Shown as negative amounts, as Shopify does. */
const DEDUCTIONS = new Set(["discounts", "sales_reversals"]);

function Card({ title, value, children, className }: { title: string; value?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("card min-w-0 p-4", className)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {value}
      </div>
      {children}
    </section>
  );
}

function NotConnected({ title }: { title: string }) {
  return (
    <Card title={title}>
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center text-sm text-muted">
        <PlugZap size={20} />
        <span className="font-medium text-ink">Not connected</span>
        <span className="max-w-sm">
          Sessions come from ShopifyQL. The Shopify app needs the <code>read_reports</code> scope and protected customer data access (level 2) for every store in
          this scope. Grant them in the Shopify Partner dashboard, then reconnect the store in Settings.
        </span>
      </div>
    </Card>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const view = parseView(await searchParams);
  const scope = await scopeFor(view.scope);
  const [b, channels, products, notes] = await Promise.all([
    metricBundle(scope, view.range, view.compare, view.currency, view.granularity),
    salesByChannel(scope.storeIds, view.range, view.currency),
    topProducts(scope.storeIds, view.range, view.currency),
    chartNotesIn(view.range.from, view.range.to, scope.storeIds),
  ]);
  const meta = new Map(metricMeta().map((m) => [m.id, m]));
  const cur = view.currency;

  const overTime = (id: string): Series[] => [
    { name: "Selected period", points: b.series[id] },
    ...(b.compareSeries ? [{ name: "Comparison", points: b.compareSeries[id], compare: true }] : []),
  ];
  const headline = (id: string, bundle: MetricBundle = b) => {
    const m = meta.get(id)!;
    return (
      <span className="flex items-baseline gap-2">
        <span className="tabular text-lg font-semibold">{fmt(bundle.current[id], m.format, cur)}</span>
        {view.compare && <Delta change={bundle.changes[id]} higherIsBetter={m.higherIsBetter} />}
      </span>
    );
  };
  const chart = (id: string, title: string, format: Fmt, n: Note[] = []) => (
    <Card title={title} value={headline(id)}>
      <TimeSeries series={overTime(id)} format={format} currency={cur} notes={n} height={240} />
    </Card>
  );

  return (
    <>
      <PageHeader title="Store analytics" subtitle={<RangeNote view={view} />} view={view} showGranularity />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Total sales over time" value={headline("total_sales")} className="lg:col-span-2">
          <TimeSeries series={overTime("total_sales")} format="money" currency={cur} notes={notes} area />
        </Card>

        <Card title="Total sales breakdown">
          <div className="-mx-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th className="num text-right!">Selected</th>
                  {b.previous && <th className="num text-right!">Comparison</th>}
                  {b.previous && <th className="num text-right!">Change</th>}
                </tr>
              </thead>
              <tbody>
                {BREAKDOWN.map(([id, label]) => {
                  const sign = DEDUCTIONS.has(id) ? -1 : 1;
                  const strong = id === "net_sales" || id === "total_sales";
                  const v = b.current[id], p = b.previous?.[id];
                  return (
                    <tr key={id}>
                      <td className={cn(strong && "font-semibold")}>{label}</td>
                      <td className={cn("num", strong && "font-semibold")}>{fmt(v === null ? null : sign * v, "money", cur)}</td>
                      {b.previous && <td className="num text-muted">{fmt(p === null || p === undefined ? null : sign * p, "money", cur)}</td>}
                      {b.previous && (
                        <td className="num">
                          <Delta change={b.changes[id]} higherIsBetter={meta.get(id)!.higherIsBetter} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Sales by channel" value={<span className="text-xs text-muted">Order revenue, before returns</span>}>
          {channels.length ? <HBar rows={channels} format="money" currency={cur} /> : <p className="py-10 text-center text-sm text-muted">No orders in this range.</p>}
        </Card>

        <Card title="Top products by net sales" value={<span className="text-xs text-muted">Gross − discounts, ex tax</span>}>
          {products.length ? <HBar rows={products} format="money" currency={cur} /> : <p className="py-10 text-center text-sm text-muted">No orders in this range.</p>}
        </Card>

        {chart("aov", "Average order value over time", "money")}

        {b.sessionsOk ? (
          <>
            {chart("sessions", "Sessions over time", "number")}
            {chart("conversion_rate", "Conversion rate over time", "percent")}
            <Card title="Conversion funnel" className="lg:col-span-2" value={headline("conversion_rate")}>
              <Funnel
                stages={[
                  { label: "Sessions", value: b.current.sessions ?? 0 },
                  { label: "Added to cart", value: b.current.added_to_cart ?? 0 },
                  { label: "Reached checkout", value: b.current.reached_checkout ?? 0 },
                  { label: "Completed checkout", value: b.current.completed_checkout ?? 0 },
                ]}
              />
            </Card>
          </>
        ) : (
          <>
            <NotConnected title="Sessions over time" />
            <NotConnected title="Conversion rate over time" />
            <NotConnected title="Conversion funnel" />
          </>
        )}
      </div>
    </>
  );
}
