"use client";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, FunnelChart, CustomChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, DataZoomComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

echarts.use([BarChart, LineChart, FunnelChart, CustomChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, DataZoomComponent, SVGRenderer]);

export interface Theme {
  ink: string;
  muted: string;
  line: string;
  surface: string;
  series: string[];
  pos: string;
  neg: string;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    ink: v("--ink"),
    muted: v("--muted"),
    line: v("--line"),
    surface: v("--surface"),
    series: [1, 2, 3, 4, 5, 6].map((i) => v(`--chart-${i}`)),
    pos: v("--pos"),
    neg: v("--neg"),
  };
}

/** Theme-aware ECharts host. `build` receives the current palette so dark mode is selected, not flipped. */
export function EChart({ build, height = 280, className }: { build: (t: Theme) => EChartsOption; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readTheme());
    const onTheme = () => setTheme(readTheme());
    window.addEventListener("themechange", onTheme);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onTheme);
    return () => {
      window.removeEventListener("themechange", onTheme);
      mq.removeEventListener("change", onTheme);
    };
  }, []);

  useEffect(() => {
    if (!ref.current || !theme) return;
    if (!chart.current) chart.current = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.current.setOption(build(theme), true);
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [build, theme]);

  useEffect(() => () => chart.current?.dispose(), []);
  return <div ref={ref} className={className} style={{ height, width: "100%" }} />;
}
