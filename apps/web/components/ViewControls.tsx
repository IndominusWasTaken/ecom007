"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ScopeOption {
  value: string;
  label: string;
  group: "All" | "Regions" | "Stores";
}

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["mtd", "Month to date"],
  ["custom", "Custom…"],
] as const;

export function ViewControls({
  scopes,
  scope,
  currency,
  preset,
  from,
  to,
  compare,
  granularity,
  showScope = true,
  showCompare = true,
  showGranularity = false,
}: {
  scopes: ScopeOption[];
  scope: string;
  currency: string;
  preset: string;
  from: string;
  to: string;
  compare: string;
  granularity?: string;
  showScope?: boolean;
  showCompare?: boolean;
  showGranularity?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    start(() => router.push(`${path}?${q.toString()}`, { scroll: false }));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending && <Loader2 size={16} className="animate-spin text-muted" />}
      {showScope && (
        <select className="input min-w-36 font-medium" value={scope} onChange={(e) => set({ scope: e.target.value })} aria-label="Scope">
          {(["All", "Regions", "Stores"] as const).map((g) => {
            const opts = scopes.filter((s) => s.group === g);
            if (!opts.length) return null;
            return g === "All" ? (
              opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            ) : (
              <optgroup key={g} label={g}>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}
      <select className="input" value={preset} onChange={(e) => set({ range: e.target.value, ...(e.target.value === "custom" ? { from, to } : { from: null, to: null }) })} aria-label="Date range">
        {RANGES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {preset === "custom" && (
        <span className="flex items-center gap-1">
          <input type="date" className="input w-36" defaultValue={from} onBlur={(e) => e.target.value && set({ from: e.target.value })} aria-label="From" />
          <span className="text-muted">–</span>
          <input type="date" className="input w-36" defaultValue={to} onBlur={(e) => e.target.value && set({ to: e.target.value })} aria-label="To" />
        </span>
      )}
      {showCompare && (
        <select className="input" value={compare} onChange={(e) => set({ compare: e.target.value })} aria-label="Compare">
          <option value="previous">vs previous period</option>
          <option value="lastyear">vs same period last year</option>
          <option value="none">No comparison</option>
        </select>
      )}
      {showGranularity && (
        <select className="input" value={granularity} onChange={(e) => set({ g: e.target.value })} aria-label="Granularity">
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
      )}
      <div className="flex h-9 overflow-hidden rounded-lg border border-line bg-surface text-sm font-medium" role="group" aria-label="Currency">
        {["USD", "EUR"].map((c) => (
          <button
            key={c}
            onClick={() => set({ cur: c })}
            className={cn("px-3 transition", currency === c ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}
          >
            {c === "USD" ? "$ USD" : "€ EUR"}
          </button>
        ))}
      </div>
    </div>
  );
}
