import { dashboardLayouts, eq, getDb } from "@ecom/db";
import { DEFAULT_PINS } from "@ecom/metrics";
import { requireUser } from "@/lib/auth";
import { chartNotesIn, scopeFor } from "@/lib/data";
import { metricBundle, metricMeta } from "@/lib/metrics";
import { parseView, type SearchParams } from "@/lib/params";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { TileBoard, type Section } from "@/components/TileBoard";

export const metadata = { title: "Summary" };

const SECTIONS: Omit<Section, "ids">[] = [
  { key: "pins", title: "Pins" },
  { key: "store", title: "Store" },
  { key: "web", title: "Web analytics" },
  { key: "ads", title: "Ads" },
  { key: "costs", title: "Costs" },
  { key: "profit", title: "Profit" },
  { key: "expenses", title: "Expenses" },
];

export default async function SummaryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const [bundle, layoutRow, notes] = await Promise.all([
    metricBundle(scope, view.range, view.compare, view.currency),
    getDb().select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, user.id)),
    chartNotesIn(view.range.from, view.range.to, scope.storeIds),
  ]);
  const meta = metricMeta();
  const hideWhenOff = new Set(bundle.current.profit_after_tax === null ? ["profit_tax", "profit_after_tax"] : []);
  const sections: Section[] = SECTIONS.map((s) => ({ ...s, ids: s.key === "pins" ? [] : meta.filter((m) => m.section === s.key && !hideWhenOff.has(m.id)).map((m) => m.id) }));
  const layout = layoutRow[0]?.layout ?? { pins: DEFAULT_PINS, order: {} };
  const missingUnits = bundle.current.cogs_missing_units ?? 0;

  return (
    <>
      <PageHeader title="Summary" subtitle={<RangeNote view={view} />} view={view} />
      {missingUnits > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <strong>COGS missing:</strong> {missingUnits.toLocaleString()} units sold without a unit cost, on{" "}
          {new Intl.NumberFormat("en-US", { style: "currency", currency: view.currency }).format(bundle.current.cogs_missing_revenue ?? 0)} of revenue. Profit is overstated until a cost is added.
          <a className="underline" href="/costs?missing=1">
            Add costs
          </a>
        </div>
      )}
      <TileBoard
        meta={meta}
        sections={sections}
        current={bundle.current}
        changes={view.compare ? bundle.changes : null}
        series={bundle.series}
        compareSeries={bundle.compareSeries}
        currency={view.currency}
        initialLayout={layout}
        notes={notes}
        sessionsOk={bundle.sessionsOk}
      />
    </>
  );
}
