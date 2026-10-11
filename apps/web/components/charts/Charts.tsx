"use client";
import { useCallback } from "react";
import type { EChartsOption } from "echarts";
import { EChart, type Theme } from "./EChart";
import { fmt, type Fmt } from "./format";

export interface Series {
  name: string;
  points: [string, number | null][];
  /** Dashed, muted line for the comparison period (plotted on the same x positions). */
  compare?: boolean;
}

export interface Note {
  date: string;
  text: string;
}

const axisBase = (t: Theme) => ({
  axisLine: { lineStyle: { color: t.line } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: t.line, type: "dashed" as const } },
});

const tooltipBase = (t: Theme) => ({
  backgroundColor: t.surface,
  borderColor: t.line,
  textStyle: { color: t.ink, fontSize: 12 },
  extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;",
});

function shortDate(d: string) {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Line chart over time; comparison series are dashed and muted; chart notes are vertical markers. */
export function TimeSeries({
  series,
  format,
  currency,
  notes = [],
  height = 280,
  area = false,
  stack = false,
  kind = "line",
}: {
  series: Series[];
  format: Fmt;
  currency: string;
  notes?: Note[];
  height?: number;
  area?: boolean;
  stack?: boolean;
  kind?: "line" | "bar";
}) {
  const build = useCallback(
    (t: Theme): EChartsOption => {
      const x = series.find((s) => !s.compare)?.points.map((p) => p[0]) ?? [];
      let ci = 0;
      return {
        animation: false,
        grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
        legend: series.length > 1 ? { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: t.muted, fontSize: 12 } } : undefined,
        tooltip: {
          trigger: "axis",
          ...tooltipBase(t),
          axisPointer: { type: kind === "bar" ? "shadow" : "line", lineStyle: { color: t.muted } },
          valueFormatter: (v) => fmt(v as number, format, currency),
        },
        xAxis: { type: "category", data: x, boundaryGap: kind === "bar", ...axisBase(t), splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: shortDate, hideOverlap: true } },
        yAxis: { type: "value", ...axisBase(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmt(v, format, currency, true) } },
        series: series.map((s, i) => {
          const color = s.compare ? t.muted : t.series[ci++ % t.series.length];
          return {
            name: s.name,
            type: kind,
            data: s.points.map((p) => p[1]),
            stack: stack && !s.compare ? "total" : undefined,
            smooth: false,
            showSymbol: false,
            symbolSize: 8,
            barMaxWidth: 28,
            itemStyle: { color, borderRadius: kind === "bar" ? [4, 4, 0, 0] : undefined },
            lineStyle: { width: 2, color, type: s.compare ? "dashed" : "solid", opacity: s.compare ? 0.7 : 1 },
            areaStyle: area && !s.compare ? { color, opacity: 0.08 } : undefined,
            emphasis: { focus: "series" },
            z: s.compare ? 1 : 2,
            markLine:
              i === 0 && notes.length
                ? {
                    symbol: "none",
                    silent: false,
                    label: { formatter: (p: { data?: { name?: string } }) => p.data?.name ?? "", color: t.muted, fontSize: 10, position: "insideEndTop" },
                    lineStyle: { color: t.muted, type: "dotted", width: 1 },
                    tooltip: { show: true, formatter: (p: unknown) => (p as { data: { name: string } }).data.name },
                    data: notes.filter((n) => x.includes(n.date)).map((n) => ({ xAxis: n.date, name: n.text })),
                  }
                : undefined,
          };
        }) as EChartsOption["series"],
      };
    },
    [series, format, currency, notes, area, stack, kind],
  );
  return <EChart build={build} height={height} />;
}

/** Horizontal bars for ranked categories (sales by channel, by product). */
export function HBar({ rows, format, currency, height }: { rows: { label: string; value: number }[]; format: Fmt; currency: string; height?: number }) {
  const build = useCallback(
    (t: Theme): EChartsOption => ({
      animation: false,
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "item", ...tooltipBase(t), valueFormatter: (v) => fmt(v as number, format, currency) },
      xAxis: { type: "value", ...axisBase(t), axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: { type: "category", data: rows.map((r) => r.label).reverse(), ...axisBase(t), axisLine: { show: false }, axisLabel: { color: t.ink, fontSize: 12, width: 160, overflow: "truncate" } },
      series: [
        {
          type: "bar",
          data: rows.map((r) => r.value).reverse(),
          barMaxWidth: 18,
          itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: t.muted, fontSize: 11, formatter: (p: { value: unknown }) => fmt(p.value as number, format, currency, true) },
        },
      ],
    }),
    [rows, format, currency],
  );
  return <EChart build={build} height={height ?? Math.max(120, rows.length * 30 + 24)} />;
}

/** P&L waterfall: total sales stepping down to net profit. */
export function Waterfall({ steps, currency, height = 320 }: { steps: { label: string; value: number; total?: boolean }[]; currency: string; height?: number }) {
  const build = useCallback(
    (t: Theme): EChartsOption => {
      let running = 0;
      const base: number[] = [];
      const vals: { value: number; itemStyle: { color: string; borderRadius: number[] } }[] = [];
      for (const s of steps) {
        if (s.total) {
          base.push(Math.min(0, s.value));
          vals.push({ value: Math.abs(s.value), itemStyle: { color: s.value >= 0 ? t.series[0] : t.neg, borderRadius: [4, 4, 0, 0] } });
          running = s.value;
        } else {
          const next = running + s.value;
          base.push(Math.min(running, next));
          vals.push({ value: Math.abs(s.value), itemStyle: { color: s.value >= 0 ? t.pos : t.neg, borderRadius: [4, 4, 4, 4] } });
          running = next;
        }
      }
      return {
        animation: false,
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          ...tooltipBase(t),
          formatter: (p: unknown) => {
            const i = (p as { dataIndex: number }[])[1]?.dataIndex ?? 0;
            const s = steps[i];
            return `${s.label}<br/><b>${fmt(s.value, "money", currency)}</b>`;
          },
        },
        xAxis: { type: "category", data: steps.map((s) => s.label), ...axisBase(t), axisLabel: { color: t.muted, fontSize: 11, interval: 0, rotate: steps.length > 7 ? 30 : 0 } },
        yAxis: { type: "value", ...axisBase(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmt(v, "money", currency, true) } },
        series: [
          { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false } },
          {
            type: "bar",
            stack: "w",
            data: vals,
            barMaxWidth: 44,
            labelLayout: { hideOverlap: true },
            label: { show: true, position: "top", color: t.ink, fontSize: 11, formatter: (p: { dataIndex: number }) => fmt(steps[p.dataIndex].value, "money", currency, true) },
          },
        ],
      };
    },
    [steps, currency],
  );
  return <EChart build={build} height={height} />;
}

/** Sessions → cart → checkout → completed, as ordered bars with step conversion. */
export function Funnel({ stages }: { stages: { label: string; value: number }[] }) {
  const build = useCallback(
    (t: Theme): EChartsOption => ({
      animation: false,
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        ...tooltipBase(t),
        formatter: (p: unknown) => {
          const i = (p as { dataIndex: number }[])[0].dataIndex;
          const s = stages[i];
          const first = stages[0].value || 1;
          const prev = i > 0 ? stages[i - 1].value || 1 : first;
          return `${s.label}<br/><b>${fmt(s.value, "number")}</b><br/>${fmt(s.value / first, "percent")} of sessions${i > 0 ? ` · ${fmt(s.value / prev, "percent")} of previous step` : ""}`;
        },
      },
      xAxis: { type: "category", data: stages.map((s) => s.label), ...axisBase(t), splitLine: { show: false } },
      yAxis: { type: "value", ...axisBase(t), axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmt(v, "number", "USD", true) } },
      series: [
        {
          type: "bar",
          data: stages.map((s) => s.value),
          barMaxWidth: 64,
          itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
          label: {
            show: true,
            position: "top",
            color: t.ink,
            fontSize: 11,
            formatter: (p: { dataIndex: number; value: unknown }) => `${fmt(p.value as number, "number", "USD", true)} · ${fmt((p.value as number) / (stages[0].value || 1), "percent")}`,
          },
        },
      ],
    }),
    [stages],
  );
  return <EChart build={build} height={280} />;
}
