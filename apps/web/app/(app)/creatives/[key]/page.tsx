import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getDb, sql } from "@ecom/db";
import { requireUser } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { adMetricMeta, adScopeWhere } from "@/lib/ads";
import { parseView, viewQuery, type SearchParams } from "@/lib/params";
import { PageHeader, RangeNote } from "@/components/PageHeader";
import { StatusPill } from "@/components/ads/StatusPill";
import { TimeSeries, type Series } from "@/components/charts/Charts";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import { allTags, loadCreativeGroups } from "../data";
import { CreativeMedia } from "../CreativeMedia";
import { TagEditor } from "../TagEditor";
import { NotesEditor } from "../Controls";

export const metadata = { title: "Creative" };

const SUMMARY = ["spend", "purchases", "purchase_value", "roas", "cpa", "ctr", "cpm", "hook_rate", "hold_rate", "impressions"];
const AD_COLS = ["spend", "impressions", "ctr", "cpm", "purchases", "purchase_value", "roas", "cpa", "hook_rate", "hold_rate"];

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Daily spend and purchase value (Meta-reported) for one creative group. */
async function dailySeries(key: string, where: ReturnType<typeof sql>, range: { from: string; to: string }, currency: "USD" | "EUR") {
  const cur = currency === "EUR" ? "eur" : "usd";
  const res = await getDb().execute<{ date: string; spend: string; value: string }>(
    sql`select d::date::text as date, coalesce(sum(${sql.raw(`m.spend_${cur}`)}), 0)::text as spend, coalesce(sum(${sql.raw(`m.purchase_value_${cur}`)}), 0)::text as value
        from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
        left join daily_ad_metrics m on m.date = d::date and m.creative_group_key = ${key} and ${where}
        group by d order by d`,
  );
  return res.rows.map((r) => ({ date: r.date, spend: Number(r.spend), value: Number(r.value) }));
}

export default async function CreativeDetailPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  await requireUser();
  const [{ key: rawKey }, sp] = await Promise.all([params, searchParams]);
  const key = safeDecode(rawKey);
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const where = adScopeWhere(scope);

  const [groups, tags, daily, prevDaily, copyRes, notesRes] = await Promise.all([
    loadCreativeGroups(scope, view.range, view.currency, key),
    allTags(),
    dailySeries(key, where, view.range, view.currency),
    view.compare ? dailySeries(key, where, view.compare, view.currency) : Promise.resolve(null),
    getDb().execute<{ primary_text: string | null; headline: string | null; description: string | null; call_to_action: string | null; n: number }>(
      sql`select primary_text, headline, description, call_to_action, count(*)::int as n from creatives
          where group_key = ${key} group by 1, 2, 3, 4 order by n desc, headline`,
    ),
    getDb().execute<{ notes: string | null; n: number }>(sql`select (array_agg(notes order by id) filter (where notes is not null))[1] as notes, count(*)::int as n from creatives where group_key = ${key}`),
  ]);
  const g = groups[0];
  if (!g) {
    if (!notesRes.rows[0]?.n) notFound();
    return (
      <>
        <PageHeader title={key} view={view} />
        <div className="card px-6 py-16 text-center text-sm text-muted">This creative has no delivery in the selected store scope.</div>
      </>
    );
  }

  const meta = new Map(adMetricMeta().map((m) => [m.id, m]));
  const isVideo = g.format === "video";
  const show = (id: string, v: number | null | undefined, compact = false) => ((id === "hook_rate" || id === "hold_rate") && !isVideo ? "—" : fmt(v, meta.get(id)?.format ?? "number", view.currency, compact));

  const series = (pick: "spend" | "value", label: string): Series[] => {
    const s: Series[] = [{ name: label, points: daily.map((d) => [d.date, d[pick]]) }];
    if (prevDaily) s.push({ name: "Previous period", points: daily.map((d, i) => [d.date, prevDaily[i]?.[pick] ?? null]), compare: true });
    return s;
  };

  // Group totals are summed from the same daily rows, so ratios are recomputed, not averaged.
  const totals = g.values;
  const back = `/creatives${viewQuery(sp) ? `?${viewQuery(sp)}` : ""}`;

  return (
    <>
      <Link href={back} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Creative library
      </Link>
      <PageHeader title={g.name} subtitle={<RangeNote view={view} />} view={view} />

      <div className="mb-5 grid gap-5 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <CreativeMedia media={g.media} format={g.format} postUrl={g.postUrl} name={g.name} />
          <div className="flex flex-col gap-2 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="pill bg-surface-2 capitalize text-muted">{g.format}</span>
              <StatusPill status={g.status} />
              {g.postUrl && (
                <a href={g.postUrl} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  View post <ExternalLink size={12} />
                </a>
              )}
            </div>
            <div className="text-xs text-muted tabular">
              First active <span className="text-ink">{g.firstActive ?? "—"}</span> · last active <span className="text-ink">{g.lastActive ?? "—"}</span>
              {g.daysRunning !== null && <> · {g.daysRunning} days running</>}
            </div>
            <div className="truncate text-xs text-muted" title={g.key}>
              Group key: <code className="font-mono">{g.key}</code>
            </div>
            <div className="mt-1">
              <div className="label">Tags</div>
              <TagEditor groupKey={g.key} tags={g.tags} allTags={tags} />
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold whitespace-nowrap">In range</h2>
              <span className="text-xs text-muted">Meta-reported · profit uses blended Shopify numbers</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
              {SUMMARY.map((id) => (
                <div key={id} className="min-w-0">
                  <dt className="truncate text-xs text-muted" title={meta.get(id)?.formula}>
                    {meta.get(id)?.label}
                  </dt>
                  <dd className="truncate text-lg font-semibold tabular">{show(id, g.values[id])}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="grid gap-5 md:grid-cols-2">
            <section className="card min-w-0 p-4">
              <h2 className="mb-2 text-sm font-semibold">Spend per day</h2>
              <TimeSeries series={series("spend", "Spend")} format="money" currency={view.currency} height={200} area />
            </section>
            <section className="card min-w-0 p-4">
              <h2 className="mb-2 text-sm font-semibold">
                Purchase value per day <span className="font-normal text-muted">· Meta-reported</span>
              </h2>
              <TimeSeries series={series("value", "Purchase value")} format="money" currency={view.currency} height={200} area />
            </section>
          </div>
        </div>
      </div>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold">Ads using this creative</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Campaign · ad set</th>
                <th>Store</th>
                <th>Status</th>
                {AD_COLS.map((c) => (
                  <th key={c} className="text-right" title={`${meta.get(c)?.formula} · Meta-reported`}>
                    {meta.get(c)?.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.ads.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.name}</td>
                  <td className="max-w-64 truncate text-muted" title={`${a.campaign ?? ""} › ${a.adSet ?? ""}`}>
                    {a.campaign ?? "—"} <span className="text-line-strong">›</span> {a.adSet ?? "—"}
                  </td>
                  <td className={cn(a.store === "Unassigned" && "text-warn")}>{a.store}</td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                  {AD_COLS.map((c) => (
                    <td key={c} className="num">
                      {show(c, a.values[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {g.ads.length > 1 && (
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td colSpan={4} className="border-t border-line-strong px-3 py-2">
                    Total
                  </td>
                  {AD_COLS.map((c) => (
                    <td key={c} className="num border-t border-line-strong px-3 py-2">
                      {show(c, totals[c])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Copy variants</h2>
          <ul className="flex flex-col divide-y divide-line">
            {copyRes.rows.map((c, i) => (
              <li key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.headline || <span className="text-muted">No headline</span>}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {c.n} creative{c.n === 1 ? "" : "s"}
                    {c.call_to_action && ` · ${c.call_to_action.replace(/_/g, " ").toLowerCase()}`}
                  </span>
                </div>
                {c.primary_text && <p className="text-sm whitespace-pre-line text-ink/90">{c.primary_text}</p>}
                {c.description && <p className="mt-1 text-xs text-muted">{c.description}</p>}
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Notes</h2>
          <NotesEditor groupKey={g.key} notes={notesRes.rows[0]?.notes ?? ""} />
        </section>
      </div>
    </>
  );
}
