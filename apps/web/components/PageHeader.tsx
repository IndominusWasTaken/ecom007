import { Suspense } from "react";
import { storesAndRegions, syncStamp, openNotices } from "@/lib/data";
import type { ViewParams } from "@/lib/params";
import { ViewControls, type ScopeOption } from "./ViewControls";
import { ThemeToggle } from "./ThemeToggle";
import { Notices } from "./Notices";
import { cn } from "@/lib/cn";

function ago(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export async function LastSynced() {
  const s = await syncStamp();
  return (
    <a
      href="/settings?tab=sync"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium",
        s.stale ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface text-muted",
      )}
      title={s.errors.map((e) => `${e.source}: ${e.error}`).join("\n") || "All sources synced"}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.stale ? "bg-warn" : "bg-pos")} />
      {s.at ? `Synced ${ago(s.at)}` : "Not synced yet"}
      {s.errors.length > 0 && <span className="text-neg">· {s.errors.length} error{s.errors.length > 1 ? "s" : ""}</span>}
    </a>
  );
}

export async function scopeOptions(): Promise<ScopeOption[]> {
  const rows = await storesAndRegions();
  const opts: ScopeOption[] = [{ value: "all", label: "All stores", group: "All" }];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.active || seen.has(r.region_code)) continue;
    seen.add(r.region_code);
    opts.push({ value: `region:${r.region_code}`, label: r.region_name, group: "Regions" });
  }
  for (const r of rows) if (r.active) opts.push({ value: `store:${r.store_id}`, label: `${r.store_name} (${r.currency})`, group: "Stores" });
  return opts;
}

export async function PageHeader({
  title,
  subtitle,
  view,
  showScope = true,
  showCompare = true,
  showGranularity = false,
  showControls = true,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  view?: ViewParams;
  showScope?: boolean;
  showCompare?: boolean;
  showGranularity?: boolean;
  showControls?: boolean;
  actions?: React.ReactNode;
}) {
  const [scopes, notices] = await Promise.all([scopeOptions(), openNotices()]);
  return (
    <header className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Suspense fallback={null}>
            <LastSynced />
          </Suspense>
          <Notices items={notices} />
          <ThemeToggle />
        </div>
      </div>
      {showControls && view && (
        <ViewControls
          scopes={scopes}
          scope={view.scope}
          currency={view.currency}
          preset={view.preset}
          from={view.range.from}
          to={view.range.to}
          compare={view.compareMode}
          granularity={view.granularity}
          showScope={showScope}
          showCompare={showCompare}
          showGranularity={showGranularity}
        />
      )}
    </header>
  );
}

export function RangeNote({ view }: { view: ViewParams }) {
  return (
    <span className="tabular">
      {view.range.from === view.range.to ? view.range.from : `${view.range.from} → ${view.range.to}`}
      {view.compare && (
        <span className="text-muted">
          {" "}
          · compared with {view.compare.from} → {view.compare.to}
        </span>
      )}
    </span>
  );
}
