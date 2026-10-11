import Link from "next/link";
import { Info, X } from "lucide-react";
import { getDb, sql } from "@ecom/db";
import { addAdTotals, emptyAdTotals } from "@ecom/metrics";
import { requireUser } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { adMetricMeta, adScopeWhere, adSumSelect, adValues, spendSeries, statusOf, totalsOf } from "@/lib/ads";
import { parseView, withParams, type SearchParams } from "@/lib/params";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { TimeSeries, type Series } from "@/components/charts/Charts";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import { AdsTable, type AdRow } from "./AdsTable";

export const metadata = { title: "Ads" };

type Level = "campaign" | "adset" | "ad";
const LEVELS: [Level, string][] = [
  ["campaign", "Campaigns"],
  ["adset", "Ad sets"],
  ["ad", "Ads"],
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const intParam = (v: string | string[] | undefined) => (one(v) && /^\d+$/.test(one(v)!) ? Number(one(v)) : null);

/** FROM/SELECT pieces per level: the entity, its parent label and the store its campaign maps to. */
function levelSql(level: Level) {
  switch (level) {
    case "campaign":
      return {
        cols: sql`e.id, e.name, e.effective_status, null::text as parent, null::int as parent_id, st.name as store`,
        from: sql`join campaigns e on e.id = m.campaign_id left join stores st on st.id = e.store_id`,
      };
    case "adset":
      return {
        cols: sql`e.id, e.name, e.effective_status, c.name as parent, c.id as parent_id, st.name as store`,
        from: sql`join ad_sets e on e.id = m.ad_set_id left join campaigns c on c.id = e.campaign_id left join stores st on st.id = c.store_id`,
      };
    case "ad":
      return {
        cols: sql`e.id, e.name, e.effective_status, s.name as parent, s.id as parent_id, st.name as store`,
        from: sql`join ads e on e.id = m.ad_id left join ad_sets s on s.id = e.ad_set_id left join campaigns c on c.id = e.campaign_id left join stores st on st.id = c.store_id`,
      };
  }
}

export default async function AdsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const level: Level = one(sp.level) === "adset" || one(sp.level) === "ad" ? (one(sp.level) as Level) : "campaign";
  const unassigned = one(sp.unassigned) === "1";
  const campaignId = intParam(sp.campaign);
  const adSetId = intParam(sp.adset);
  const q = (one(sp.q) ?? "").trim();
  const status = one(sp.status) ?? "all";

  const where = adScopeWhere(scope, unassigned);
  // Drill-down from a campaign or ad set row narrows both the chart and the table.
  const drilled = sql`${where}${campaignId ? sql` and m.campaign_id = ${campaignId}` : sql``}${adSetId ? sql` and m.ad_set_id = ${adSetId}` : sql``}`;
  const filters = [sql`m.date between ${view.range.from} and ${view.range.to}`, drilled];
  const { cols, from } = levelSql(level);
  if (q) filters.push(sql`e.name ilike ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"}`);

  const db = getDb();
  const [res, series, compareSeries, crumbs] = await Promise.all([
    db.execute<Record<string, string | number | null>>(
      sql`select ${cols}, ${adSumSelect(view.currency)}
          from daily_ad_metrics m ${from}
          where ${sql.join(filters, sql` and `)}
          group by 1, 2, 3, 4, 5, 6`,
    ),
    spendSeries(drilled, view.range, view.currency),
    view.compare ? spendSeries(drilled, view.compare, view.currency) : Promise.resolve(null),
    db.execute<{ campaign: string | null; adset: string | null }>(
      sql`select (select name from campaigns where id = ${campaignId ?? 0}) as campaign, (select name from ad_sets where id = ${adSetId ?? 0}) as adset`,
    ),
  ]);

  const total = emptyAdTotals();
  const rows: AdRow[] = [];
  for (const r of res.rows) {
    const st = statusOf(r.effective_status as string | null);
    if (status !== "all" && st !== status) continue;
    const t = totalsOf(r);
    addAdTotals(total, t);
    const id = Number(r.id);
    rows.push({
      id,
      name: String(r.name),
      parent: (r.parent as string | null) || null,
      status: st,
      store: (r.store as string | null) ?? "Unassigned",
      href: level === "campaign" ? withParams("/ads", sp, { level: "adset", campaign: String(id), adset: null }) : level === "adset" ? withParams("/ads", sp, { level: "ad", adset: String(id) }) : null,
      values: adValues(t),
    });
  }
  const totals = adValues(total);

  const chart: Series[] = [{ name: "Spend", points: series }];
  if (compareSeries) chart.push({ name: "Previous period", points: series.map((p, i) => [p[0], compareSeries[i]?.[1] ?? null]), compare: true });

  const levelHref = (l: Level) => withParams("/ads", sp, { level: l });
  const crumb = crumbs.rows[0];

  return (
    <>
      <PageHeader title="Ads" subtitle={<RangeNote view={view} />} view={view} />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Every number on this page is <strong className="text-ink">Meta-reported</strong> (platform attribution, account settings). Profit and blended ROAS elsewhere use Shopify revenue against all ad
          spend, so they will not match these purchase values.
        </span>
      </div>

      <section className="card mb-5 p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Spend per day</h2>
          <span className="text-xs text-muted tabular">
            {fmt(totals.spend, "money", view.currency)} spend · Meta-reported
          </span>
        </div>
        <TimeSeries series={chart} format="money" currency={view.currency} height={220} area />
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-9 overflow-hidden rounded-lg border border-line bg-surface text-sm font-medium" role="tablist" aria-label="Level">
          {LEVELS.map(([l, label]) => (
            <Link key={l} href={levelHref(l)} role="tab" aria-selected={level === l} className={cn("flex items-center px-3 transition", level === l ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}>
              {label}
            </Link>
          ))}
        </div>
        <Link
          href={withParams("/ads", sp, { unassigned: unassigned ? null : "1" })}
          className={cn("pill h-7 gap-1 border px-2.5", unassigned ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface text-muted hover:text-ink")}
          title="Spend in ad accounts or campaigns that are not mapped to any store"
        >
          Unassigned only {unassigned && <X size={12} />}
        </Link>
        {campaignId && (
          <Link href={withParams("/ads", sp, { campaign: null, adset: null })} className="pill h-7 gap-1 border border-accent/30 bg-accent-soft px-2.5 text-accent">
            Campaign: {crumb?.campaign ?? campaignId} <X size={12} />
          </Link>
        )}
        {adSetId && (
          <Link href={withParams("/ads", sp, { adset: null })} className="pill h-7 gap-1 border border-accent/30 bg-accent-soft px-2.5 text-accent">
            Ad set: {crumb?.adset ?? adSetId} <X size={12} />
          </Link>
        )}
        {unassigned && view.scope !== "all" && <span className="text-xs text-muted">Unassigned spend belongs to no store, so the store/region scope is ignored.</span>}
      </div>

      <AdsTable
        key={`${level}-${user.id}`}
        rows={rows}
        totals={totals}
        meta={adMetricMeta()}
        currency={view.currency}
        level={level}
        storageKey={`ads.columns.${user.id}`}
        q={q}
        status={status}
      />
    </>
  );
}
