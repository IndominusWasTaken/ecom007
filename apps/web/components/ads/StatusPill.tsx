import { cn } from "@/lib/cn";

export type AdStatus = "active" | "paused" | "archived";

const STYLE: Record<AdStatus, string> = {
  active: "bg-pos-soft text-pos",
  paused: "bg-warn-soft text-warn",
  archived: "bg-surface-2 text-muted",
};

/** effective_status pill; usable from server and client components. */
export function StatusPill({ status, className }: { status: AdStatus; className?: string }) {
  return (
    <span className={cn("pill gap-1 capitalize", STYLE[status], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", status === "active" ? "bg-pos" : status === "paused" ? "bg-warn" : "bg-muted")} />
      {status}
    </span>
  );
}
