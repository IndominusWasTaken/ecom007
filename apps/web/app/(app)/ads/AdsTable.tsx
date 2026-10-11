"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Columns3, Loader2, Search } from "lucide-react";
import { fmt, type Fmt } from "@/components/charts/format";
import { StatusPill, type AdStatus } from "@/components/ads/StatusPill";
import { cn } from "@/lib/cn";

type Num = number | null;

export interface AdRow {
  id: number;
  name: string;
  parent: string | null;
  status: AdStatus;
  store: string;
  /** Drill-down link (campaign → its ad sets, ad set → its ads). */
  href: string | null;
  values: Record<string, Num>;
}

interface Meta {
  id: string;
  label: string;
  format: Fmt;
  formula: string;
}

export const DEFAULT_AD_COLUMNS = ["spend", "impressions", "cpm", "link_clicks", "ctr", "cpc", "adds_to_cart", "purchases", "purchase_value", "roas", "cpa", "hook_rate", "hold_rate"];

type SortKey = "name" | "status" | "store" | string;

/** Ads Manager-style table: column picker (saved per user in this browser), sortable headers, totals row. */
export function AdsTable({
  rows,
  totals,
  meta,
  currency,
  level,
  storageKey,
  q,
  status,
}: {
  rows: AdRow[];
  totals: Record<string, Num>;
  meta: Meta[];
  currency: string;
  level: "campaign" | "adset" | "ad";
  storageKey: string;
  q: string;
  status: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [cols, setCols] = useState<string[]>(DEFAULT_AD_COLUMNS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState(q);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved) && saved.length) setCols(saved.filter((c) => meta.some((m) => m.id === c)));
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, [storageKey, meta]);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => pickerRef.current && !pickerRef.current.contains(e.target as Node) && setPickerOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  const saveCols = (next: string[]) => {
    setCols(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const setParam = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
    start(() => router.push(`${path}?${u}`, { scroll: false }));
  };

  const byId = useMemo(() => new Map(meta.map((m) => [m.id, m])), [meta]);
  const shown = cols.map((c) => byId.get(c)).filter((m): m is Meta => !!m);

  const sorted = useMemo(() => {
    const val = (r: AdRow) => (sort.key === "name" ? r.name : sort.key === "status" ? r.status : sort.key === "store" ? r.store : r.values[sort.key]);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      // nulls (undefined ratios) always last
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sort.dir;
      return (va - vb) * sort.dir;
    });
  }, [rows, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "store" || key === "status" ? 1 : -1 }));

  const th = (k: SortKey, label: string, title?: string, right?: boolean) => (
    <th key={k} className={cn(right && "text-right", k === "name" && "sticky left-0 z-[2]")} title={title} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button onClick={() => toggleSort(k)} className={cn("inline-flex items-center gap-1 hover:text-ink", right && "flex-row-reverse", sort.key === k && "text-ink")}>
        {label}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  const noun = level === "campaign" ? "campaigns" : level === "adset" ? "ad sets" : "ads";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="relative w-full sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: search.trim() || null });
          }}
        >
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input className="input w-full" style={{ paddingLeft: 32 }} placeholder={`Search ${noun}…`} value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => search.trim() !== q && setParam({ q: search.trim() || null })} aria-label="Search by name" />
        </form>
        <select className="input" value={status} onChange={(e) => setParam({ status: e.target.value === "all" ? null : e.target.value })} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
        {pending && <Loader2 size={16} className="animate-spin text-muted" />}
        <div className="relative ml-auto" ref={pickerRef}>
          <button className="btn" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
            <Columns3 size={15} /> Columns
          </button>
          {pickerOpen && (
            <div className="card absolute right-0 z-20 mt-1 max-h-96 w-64 overflow-y-auto p-2">
              <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted">
                <span>{shown.length} shown · Meta-reported</span>
                <button className="hover:text-ink" onClick={() => saveCols(DEFAULT_AD_COLUMNS)}>
                  Reset
                </button>
              </div>
              {meta.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2" title={m.formula}>
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={cols.includes(m.id)}
                    onChange={(e) => saveCols(e.target.checked ? [...cols, m.id] : cols.filter((c) => c !== m.id))}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {th("name", level === "campaign" ? "Campaign" : level === "adset" ? "Ad set" : "Ad")}
              {th("status", "Status")}
              {th("store", "Store")}
              {shown.map((m) => th(m.id, m.label, `${m.formula} · Meta-reported`, true))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td className="sticky left-0 z-[1] max-w-40 bg-surface sm:max-w-72">
                  {r.href ? (
                    <Link href={r.href} className="block truncate font-medium hover:text-accent hover:underline" title={r.name}>
                      {r.name}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium" title={r.name}>
                      {r.name}
                    </span>
                  )}
                  {r.parent && <span className="block truncate text-xs text-muted" title={r.parent}>{r.parent}</span>}
                </td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td className={cn(r.store === "Unassigned" && "text-warn")}>{r.store}</td>
                {shown.map((m) => (
                  <td key={m.id} className="num">
                    {fmt(r.values[m.id], m.format, currency)}
                  </td>
                ))}
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={3 + shown.length} className="py-10 text-center text-muted">
                  No {noun} with delivery in this range{q || status !== "all" ? " match these filters" : ""}.
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="bg-surface-2 font-semibold">
                <td className="sticky left-0 z-[1] border-t border-line-strong bg-surface-2 px-3 py-2">
                  Total · {sorted.length} {noun}
                </td>
                <td className="border-t border-line-strong" />
                <td className="border-t border-line-strong" />
                {shown.map((m) => (
                  <td key={m.id} className="num border-t border-line-strong px-3 py-2">
                    {fmt(totals[m.id], m.format, currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
