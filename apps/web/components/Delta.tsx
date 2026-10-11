import { fmtChange } from "./charts/format";
import { cn } from "@/lib/cn";

/** Comparison change pill: green when the move is good news for this metric, red when bad. */
export function Delta({ change, higherIsBetter = true, className }: { change: number | null | undefined; higherIsBetter?: boolean; className?: string }) {
  const good = change === null || change === undefined || change === 0 ? null : change > 0 === higherIsBetter;
  return (
    <span className={cn("pill tabular", good === null ? "bg-surface-2 text-muted" : good ? "bg-pos-soft text-pos" : "bg-neg-soft text-neg", className)}>
      {fmtChange(change)}
    </span>
  );
}

/** Link styled as a small button that downloads a CSV export. */
export function ExportLink({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return (
    <a className="btn btn-sm" href={href} download>
      {label}
    </a>
  );
}
