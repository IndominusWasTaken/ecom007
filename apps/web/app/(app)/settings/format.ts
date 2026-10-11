import { BUSINESS_TZ } from "@ecom/core/config";

/** Timestamps on the settings page are shown in business time (Sofia). */
export function when(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { timeZone: BUSINESS_TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function duration(start: Date | string, end: Date | string | null): string {
  if (!end) return "running";
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Status pill classes shared by connections and sync runs. */
export function statusPill(status: string | null | undefined): string {
  switch (status) {
    case "ok":
      return "bg-pos-soft text-pos";
    case "error":
      return "bg-neg-soft text-neg";
    case "running":
    case "new":
      return "bg-accent-soft text-accent";
    default:
      return "bg-surface-2 text-muted";
  }
}
