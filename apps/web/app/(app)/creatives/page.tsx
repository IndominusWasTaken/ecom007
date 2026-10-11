import Link from "next/link";
import { ChevronDown, Info } from "lucide-react";
import { getDb, sql } from "@ecom/db";
import { requireUser } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { adMetricMeta } from "@/lib/ads";
import { parseView, withParams, type SearchParams } from "@/lib/params";
import { PageHeader, RangeNote, scopeOptions } from "@/components/PageHeader";
import { StatusPill } from "@/components/ads/StatusPill";
import { fmt, type Fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import { allTags, loadCreativeGroups, type CreativeGroup } from "./data";
import { CreativeMedia } from "./CreativeMedia";
import { TagEditor } from "./TagEditor";
import { CreativeToolbar, DeleteViewButton } from "./Controls";

export const metadata = { title: "Creative library" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Filter keys a tab sets; tabs replace these and keep sort, search and the date range. */
const TAB_KEYS = ["scope", "status", "format", "tag"] as const;
const SAVED_KEYS = ["scope", "status", "format", "tag", "sort", "q"];

const SORTS = ["spend", "purchases", "purchase_value", "roas", "cpa", "ctr", "cpm", "hook_rate", "hold_rate", "impressions", "last_active", "days_running"];

const CARD_METRICS: [string, string][] = [
  ["spend", "Spend"],
  ["purchases", "Purchases"],
  ["roas", "ROAS"],
  ["cpa", "CPA"],
  ["ctr", "CTR"],
  ["cpm", "CPM"],
  ["hook_rate", "Hook rate"],
  ["hold_rate", "Hold rate"],
];

function shortDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}

export default async function CreativesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const status = one(sp.status) ?? "";
  const format = one(sp.format) ?? "";
  const tag = one(sp.tag) ?? "";
  const q = (one(sp.q) ?? "").trim().toLowerCase();
  const sort = SORTS.includes(one(sp.sort) ?? "") ? one(sp.sort)! : "spend";

  const [groups, tags, saved, scopes] = await Promise.all([
    loadCreativeGroups(scope, view.range, view.currency),
    allTags(),
    getDb().execute<{ id: number; name: string; query: string }>(sql`select id, name, query from saved_views where page = 'creatives' order by sort_order, id`),
    scopeOptions(),
  ]);

  const meta = new Map(adMetricMeta().map((m) => [m.id, m]));
  const fmtOf = (id: string): Fmt => meta.get(id)?.format ?? "number";
  const visible = groups.filter(
    (g) =>
      (!status || g.status === status) &&
      (!format || g.format === format) &&
      (!tag || g.tags.some((t) => String(t.id) === tag)) &&
      (!q || [g.name, g.headline, g.primaryText, g.key, ...g.ads.map((a) => a.name)].some((s) => s?.toLowerCase().includes(q))),
  );
  // Sort: higher-is-better metrics descending, costs (CPA, CPM) ascending; empty values last.
  const asc = meta.get(sort)?.higherIsBetter === false && sort !== "spend";
  const sortVal = (g: CreativeGroup) => (sort === "last_active" ? (g.lastActive ? Date.parse(g.lastActive) : null) : sort === "days_running" ? g.daysRunning : g.values[sort]);
  visible.sort((a, b) => {
    const va = sortVal(a);
    const vb = sortVal(b);
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    return asc ? va - vb : vb - va;
  });

  // Built-in tabs, then saved ones. A tab is active when the URL's filters equal its filters.
  const current: Record<string, string> = { scope: view.scope === "all" ? "" : view.scope, status, format, tag };
  const tabHref = (patch: Partial<Record<(typeof TAB_KEYS)[number], string>>) => withParams("/creatives", sp, Object.fromEntries(TAB_KEYS.map((k) => [k, patch[k] ?? null])));
  const isActive = (patch: Partial<Record<string, string>>) => TAB_KEYS.every((k) => (patch[k] ?? "") === current[k]);
  const builtIn: { label: string; patch: Partial<Record<(typeof TAB_KEYS)[number], string>> }[][] = [
    [{ label: "All", patch: {} }],
    scopes.filter((s) => s.group !== "All").map((s) => ({ label: s.group === "Stores" ? s.label.replace(/ \(\w{3}\)$/, "") : s.label, patch: { scope: s.value } })),
    (["active", "paused", "archived"] as const).map((s) => ({ label: s[0].toUpperCase() + s.slice(1), patch: { status: s } })),
    (["video", "image", "carousel"] as const).map((f) => ({ label: f[0].toUpperCase() + f.slice(1), patch: { format: f } })),
  ];
  const savedTabs = saved.rows.map((v) => {
    const vq = new URLSearchParams(v.query);
    const patch: Record<string, string | null> = {};
    for (const k of SAVED_KEYS) patch[k] = vq.get(k);
    const active = TAB_KEYS.every((k) => (vq.get(k) ?? "") === current[k]) && (vq.get("sort") ?? "spend") === sort && (vq.get("q") ?? "") === (one(sp.q) ?? "");
    return { ...v, href: withParams("/creatives", sp, patch), active };
  });
  const filtered = TAB_KEYS.some((k) => current[k]) || !!q || sort !== "spend";
  const totalsSpend = visible.reduce((s, g) => s + (g.values.spend ?? 0), 0);

  const tabCls = (active: boolean) =>
    cn("flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition", active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink");

  return (
    <>
      <PageHeader title="Creative library" subtitle={<RangeNote view={view} />} view={view} />

      <nav className="-mx-1 mb-3 flex items-center gap-1 overflow-x-auto px-1 pb-1" aria-label="Creative tabs">
        {builtIn.map((grp, gi) => (
          <div key={gi} className={cn("flex shrink-0 items-center gap-1", gi > 0 && "border-l border-line pl-1")}>
            {grp.map((t) => (
              <Link key={t.label} href={tabHref(t.patch)} className={tabCls(isActive(t.patch))}>
                {t.label}
              </Link>
            ))}
          </div>
        ))}
        {savedTabs.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 border-l border-line pl-1">
            {savedTabs.map((t) => (
              <span key={t.id} className={cn(tabCls(t.active), "pr-1.5")}>
                <Link href={t.href}>{t.name}</Link>
                <DeleteViewButton id={t.id} name={t.name} />
              </span>
            ))}
          </div>
        )}
      </nav>

      <CreativeToolbar
        tags={tags}
        sorts={SORTS.map((id) => ({ id, label: id === "last_active" ? "Last active" : id === "days_running" ? "Days running" : (meta.get(id)?.label ?? id) }))}
        sort={sort}
        tag={tag}
        q={one(sp.q) ?? ""}
        canSave={filtered}
      />

      <p className="mb-4 flex items-start gap-1.5 text-xs text-muted">
        <Info size={13} className="mt-px shrink-0" />
        <span>
          {visible.length} creative{visible.length === 1 ? "" : "s"} · {fmt(totalsSpend, "money", view.currency)} spend in range. Metrics are <strong className="text-ink">Meta-reported</strong>; profit
          pages use blended Shopify numbers. First/last active count every day with spend, not just this range.
        </span>
      </p>

      {visible.length === 0 ? (
        <div className="card px-6 py-16 text-center text-sm text-muted">No creatives match these filters.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((g) => (
            <CreativeCard key={g.key} g={g} currency={view.currency} fmtOf={fmtOf} allTags={tags} href={withParams(`/creatives/${encodeURIComponent(g.key)}`, sp, { status: null, format: null, tag: null, sort: null, q: null })} />
          ))}
        </div>
      )}
    </>
  );
}

function CreativeCard({
  g,
  currency,
  fmtOf,
  allTags,
  href,
}: {
  g: CreativeGroup;
  currency: string;
  fmtOf: (id: string) => Fmt;
  allTags: { id: number; name: string; kind: string }[];
  href: string;
}) {
  return (
    <article className="card flex flex-col overflow-hidden">
      <CreativeMedia media={g.media} format={g.format} postUrl={g.postUrl} name={g.name} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="pill bg-surface-2 capitalize text-muted">{g.format}</span>
            <StatusPill status={g.status} />
          </div>
          <Link href={href} className="block truncate font-semibold hover:text-accent hover:underline" title={g.name}>
            {g.name}
          </Link>
          {g.headline && <div className="truncate text-xs text-muted" title={g.headline}>{g.headline}</div>}
        </div>

        <dl className="grid grid-cols-4 gap-x-2 gap-y-2.5">
          {CARD_METRICS.map(([id, label]) => (
            <div key={id} className="min-w-0">
              <dt className="truncate text-[11px] text-muted">{label}</dt>
              <dd className="truncate text-sm font-semibold tabular">{(id === "hook_rate" || id === "hold_rate") && g.format !== "video" ? "—" : fmt(g.values[id], fmtOf(id), currency, true)}</dd>
            </div>
          ))}
        </dl>

        <div className="text-xs text-muted tabular">
          {g.firstActive ? (
            <>
              {shortDate(g.firstActive)} → {shortDate(g.lastActive)} · <span className="text-ink">{g.daysRunning} day{g.daysRunning === 1 ? "" : "s"}</span> running
            </>
          ) : (
            "No spend yet"
          )}
        </div>

        <TagEditor groupKey={g.key} tags={g.tags} allTags={allTags} />

        <details className="group mt-auto border-t border-line pt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted hover:text-ink">
            {g.ads.length} ad{g.ads.length === 1 ? "" : "s"} using this creative
            <ChevronDown size={14} className="transition group-open:rotate-180" />
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {g.ads.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-medium" title={a.name}>{a.name}</span>
                  <span className={cn("block truncate", a.store === "Unassigned" ? "text-warn" : "text-muted")}>{a.store}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular">
                  <span>{fmt(a.values.spend, "money", currency, true)}</span>
                  <span className="w-12 text-right text-muted" title="ROAS (Meta-reported)">{a.values.roas === null ? "—" : `${fmt(a.values.roas, "ratio")}×`}</span>
                  <StatusPill status={a.status} className="px-1.5" />
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}
