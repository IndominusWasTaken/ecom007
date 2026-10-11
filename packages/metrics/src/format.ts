import { D, formatMoney, type DecimalLike } from "@ecom/core/money";
import type { MetricFormat } from "./registry";

export function formatValue(v: DecimalLike | null, format: MetricFormat, currency: string, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const n = D(v).toNumber();
  switch (format) {
    case "money":
      return formatMoney(v, currency, opts);
    case "percent":
      return `${(n * 100).toFixed(Math.abs(n) < 0.1 ? 2 : 1)}%`;
    case "ratio":
      return n.toFixed(2);
    case "number":
      return opts.compact && Math.abs(n) >= 10_000
        ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  }
}

export function formatChange(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return "—";
  const pct = c * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}
