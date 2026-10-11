"use client";
import { useMemo, useState, useTransition } from "react";
import { GripVertical, Maximize2, Pin, PinOff, X, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmt, fmtChange } from "./charts/format";
import { TimeSeries, type Note } from "./charts/Charts";
import { saveLayout } from "@/app/(app)/actions";
import type { MetricMeta } from "@/lib/metrics";

type Num = number | null;
export interface Layout {
  pins: string[];
  order: Record<string, string[]>;
}

export interface Section {
  key: string;
  title: string;
  ids: string[];
}

function Sparkline({ points, color }: { points: Num[]; color: string }) {
  const vals = points.map((p) => p ?? 0);
  if (vals.length < 2) return <div className="h-8" />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 120;
  const h = 32;
  const d = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({
  m,
  value,
  ch,
  spark,
  currency,
  pinned,
  onPin,
  onExpand,
  dragProps,
  unavailable,
}: {
  m: MetricMeta;
  value: Num;
  ch: number | null | undefined;
  spark: Num[];
  currency: string;
  pinned: boolean;
  onPin: () => void;
  onExpand: () => void;
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
  unavailable?: boolean;
}) {
  const good = ch === null || ch === undefined || ch === 0 ? null : ch > 0 === m.higherIsBetter;
  return (
    <div {...dragProps} className={cn("card group relative flex min-h-[132px] flex-col p-3.5 transition", dragProps.className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <GripVertical size={14} className="-ml-1 shrink-0 cursor-grab text-muted opacity-0 transition group-hover:opacity-100" />
          <span className="truncate text-[13px] font-medium text-muted" title={m.formula}>
            {m.label}
          </span>
          {m.platformReported && <span className="pill bg-surface-2 text-[10px] text-muted">Meta-reported</span>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
          <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={onPin} title={pinned ? "Unpin" : "Pin"} aria-label={pinned ? "Unpin" : "Pin"}>
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={onExpand} title="Expand" aria-label="Expand chart">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      {unavailable ? (
        <div className="mt-2 flex flex-1 flex-col justify-center">
          <span className="text-lg font-semibold text-muted">Not connected</span>
          <span className="text-xs text-muted">Needs read_reports and protected customer data access</span>
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="tabular text-[22px] font-semibold tracking-tight">{fmt(value, m.format, currency)}</span>
            {ch !== undefined && (
              <span className={cn("pill tabular", good === null ? "bg-surface-2 text-muted" : good ? "bg-pos-soft text-pos" : "bg-neg-soft text-neg")}>{fmtChange(ch)}</span>
            )}
          </div>
          <div className="mt-auto pt-2">
            <Sparkline points={spark} color={good === false ? "var(--neg)" : "var(--chart-1)"} />
          </div>
        </>
      )}
    </div>
  );
}

export function TileBoard({
  meta,
  sections,
  current,
  changes,
  series,
  compareSeries,
  currency,
  initialLayout,
  notes,
  sessionsOk,
}: {
  meta: MetricMeta[];
  sections: Section[];
  current: Record<string, Num>;
  changes: Record<string, number | null> | null;
  series: Record<string, [string, Num][]>;
  compareSeries: Record<string, [string, Num][]> | null;
  currency: string;
  initialLayout: Layout;
  notes: Note[];
  sessionsOk: boolean;
}) {
  const byId = useMemo(() => Object.fromEntries(meta.map((m) => [m.id, m])), [meta]);
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ section: string; id: string } | null>(null);
  const [, start] = useTransition();

  const persist = (l: Layout) => {
    setLayout(l);
    start(() => saveLayout(l));
  };

  const orderFor = (s: Section) => {
    if (s.key === "pins") return layout.pins.filter((id) => byId[id]);
    const saved = layout.order[s.key] ?? [];
    return [...saved.filter((id) => s.ids.includes(id)), ...s.ids.filter((id) => !saved.includes(id))];
  };

  const togglePin = (id: string) => {
    const pins = layout.pins.includes(id) ? layout.pins.filter((p) => p !== id) : [...layout.pins, id];
    persist({ ...layout, pins });
  };

  const drop = (section: string, targetId: string) => {
    if (!drag || drag.section !== section || drag.id === targetId) return;
    const list = section === "pins" ? [...layout.pins] : orderFor(sections.find((s) => s.key === section)!);
    const from = list.indexOf(drag.id);
    const to = list.indexOf(targetId);
    list.splice(from, 1);
    list.splice(to, 0, drag.id);
    persist(section === "pins" ? { ...layout, pins: list } : { ...layout, order: { ...layout.order, [section]: list } });
    setDrag(null);
  };

  const exp = expanded ? byId[expanded] : null;
  const isSessionMetric = (id: string) => byId[id]?.source === "shopify-sessions" || id === "revenue_per_session";

  return (
    <div className="flex flex-col gap-7">
      {sections.map((s) => {
        const ids = orderFor(s);
        if (!ids.length && s.key !== "pins") return null;
        return (
          <section key={s.key}>
            <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
              {s.key === "pins" && <Pin size={14} className="text-accent" />}
              {s.title}
              <span className="text-xs font-normal text-muted">{s.key === "pins" ? "Drag to reorder · pin any tile below" : ""}</span>
            </h2>
            {ids.length === 0 ? (
              <p className="card p-4 text-sm text-muted">No pinned tiles. Use the pin icon on any tile.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {ids.map((id) => (
                  <Tile
                    key={id}
                    m={byId[id]}
                    value={current[id]}
                    ch={changes ? changes[id] : undefined}
                    spark={(series[id] ?? []).map((p) => p[1])}
                    currency={currency}
                    pinned={layout.pins.includes(id)}
                    onPin={() => togglePin(id)}
                    onExpand={() => setExpanded(id)}
                    unavailable={!sessionsOk && isSessionMetric(id)}
                    dragProps={{
                      draggable: true,
                      onDragStart: () => setDrag({ section: s.key, id }),
                      onDragOver: (e) => e.preventDefault(),
                      onDrop: () => drop(s.key, id),
                      onDragEnd: () => setDrag(null),
                      className: drag?.id === id && drag.section === s.key ? "opacity-40" : "",
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {exp && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setExpanded(null)}>
          <div className="card w-full max-w-4xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{exp.label}</h3>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <Info size={12} /> {exp.formula}
                </p>
              </div>
              <button className="btn btn-sm" onClick={() => setExpanded(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <div className="mb-3 mt-2 flex items-baseline gap-2">
              <span className="tabular text-2xl font-semibold">{fmt(current[exp.id], exp.format, currency)}</span>
              {changes && <span className="text-sm text-muted">{fmtChange(changes[exp.id])} vs comparison</span>}
            </div>
            <TimeSeries
              series={[
                { name: exp.label, points: series[exp.id] ?? [] },
                ...(compareSeries ? [{ name: "Comparison period", compare: true, points: (series[exp.id] ?? []).map((p, i) => [p[0], compareSeries[exp.id]?.[i]?.[1] ?? null] as [string, Num]) }] : []),
              ]}
              format={exp.format}
              currency={currency}
              notes={notes}
              height={340}
              area
            />
          </div>
        </div>
      )}
    </div>
  );
}
