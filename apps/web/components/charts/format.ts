/** Client-safe number formatting for charts and tiles (no decimal.js needed). */
export type Fmt = "money" | "number" | "percent" | "ratio";

const SYM: Record<string, string> = { USD: "$", EUR: "€" };

export function fmt(v: number | null | undefined, f: Fmt, currency = "USD", compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  switch (f) {
    case "money": {
      const body =
        compact && abs >= 10_000
          ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(abs)
          : new Intl.NumberFormat("en-US", { minimumFractionDigits: compact && abs >= 1000 ? 0 : 2, maximumFractionDigits: compact && abs >= 1000 ? 0 : 2 }).format(abs);
      return `${sign}${SYM[currency] ?? currency + " "}${body}`;
    }
    case "percent":
      return `${sign}${(abs * 100).toFixed(abs < 0.1 ? 2 : 1)}%`;
    case "ratio":
      return `${sign}${abs.toFixed(2)}`;
    case "number":
      return sign + (compact && abs >= 10_000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(abs) : new Intl.NumberFormat("en-US", { maximumFractionDigits: abs < 10 && abs % 1 ? 2 : 0 }).format(abs));
  }
}

export function fmtChange(c: number | null | undefined) {
  if (c === null || c === undefined || !Number.isFinite(c)) return "—";
  const p = c * 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%`;
}
