import Link from "next/link";
import { cn } from "@/lib/cn";

/** Underlined tab strip driven by a query param; wraps onto a second line on phones. */
export function PageTabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav className="mb-5 border-b border-line">
      <div className="flex flex-wrap gap-x-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
              t.key === active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** USD/EUR switch for pages without the full view controls. */
export function CurrencyToggle({ current, hrefs }: { current: string; hrefs: Record<"USD" | "EUR", string> }) {
  return (
    <div className="inline-flex h-9 overflow-hidden rounded-lg border border-line bg-surface text-xs font-medium">
      {(["USD", "EUR"] as const).map((c) => (
        <Link key={c} href={hrefs[c]} className={cn("flex items-center px-2.5", c === current ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2")}>
          {c}
        </Link>
      ))}
    </div>
  );
}
