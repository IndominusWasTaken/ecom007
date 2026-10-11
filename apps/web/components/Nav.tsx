"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  Coins,
  Globe2,
  LayoutDashboard,
  Megaphone,
  Menu,
  Receipt,
  Settings,
  Sparkles,
  X,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/", label: "Summary", icon: LayoutDashboard },
  { href: "/regions", label: "Regions", icon: Globe2 },
  { href: "/pnl", label: "Profit & loss", icon: Receipt },
  { href: "/analytics", label: "Store analytics", icon: LineChart },
  { href: "/products", label: "Products", icon: Boxes },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/creatives", label: "Creative library", icon: Sparkles },
  { href: "/costs", label: "Costs", icon: Coins },
  { href: "/expenses", label: "Expenses", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings },
];

const KEEP = ["scope", "cur", "range", "from", "to", "compare"];

export function Nav({ user }: { user: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const q = new URLSearchParams();
  for (const k of KEEP) {
    const v = sp.get(k);
    if (v) q.set(k, v);
  }
  const qs = q.toString() ? `?${q}` : "";
  const links = (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={`${it.href}${it.href === "/settings" || it.href === "/expenses" || it.href === "/costs" ? "" : qs}`}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
              active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon size={16} strokeWidth={2} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <Link href="/" className="mb-5 flex items-center gap-2 px-2 text-[15px] font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink">
            <BarChart3 size={16} />
          </span>
          Profit Dashboard
        </Link>
        {links}
        <div className="mt-auto flex items-center justify-between px-2 pt-4 text-xs text-muted">
          <span>{user}</span>
          <form action="/logout" method="post">
            <button className="hover:text-ink">Log out</button>
          </form>
        </div>
      </aside>
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink">
            <BarChart3 size={16} />
          </span>
          Profit
        </Link>
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 top-[49px] z-30 overflow-y-auto bg-surface p-3 lg:hidden">
          {links}
          <form action="/logout" method="post" className="mt-4 px-2">
            <button className="btn w-full">Log out ({user})</button>
          </form>
        </div>
      )}
    </>
  );
}
