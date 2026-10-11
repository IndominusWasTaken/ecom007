"use client";
import { Bell, X } from "lucide-react";
import { useState, useTransition } from "react";
import { dismissNotice, dismissAllNotices } from "@/app/(app)/actions";
import { cn } from "@/lib/cn";

interface Notice {
  id: number;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: Date | string;
}

export function Notices({ items }: { items: Notice[] }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(items);
  const [, start] = useTransition();
  const warn = list.some((n) => n.severity !== "info");
  return (
    <div className="relative">
      <button className="btn relative w-9 px-0" onClick={() => setOpen((o) => !o)} aria-label="Notices">
        <Bell size={16} />
        {list.length > 0 && (
          <span className={cn("absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white", warn ? "bg-neg" : "bg-accent")}>
            {list.length}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-32px))] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Notices</span>
            {list.length > 0 && (
              <button
                className="text-xs text-muted hover:text-ink"
                onClick={() => {
                  setList([]);
                  start(() => dismissAllNotices());
                }}
              >
                Dismiss all
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Nothing needs your attention.</p>}
            {list.map((n) => (
              <div key={n.id} className="flex gap-3 border-b border-line px-4 py-3 last:border-0">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.severity === "error" ? "bg-neg" : n.severity === "warning" ? "bg-warn" : "bg-accent")} />
                <div className="min-w-0 flex-1">
                  {n.link ? (
                    <a href={n.link} className="text-sm font-medium hover:underline" target={n.link.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                      {n.title}
                    </a>
                  ) : (
                    <p className="text-sm font-medium">{n.title}</p>
                  )}
                  {n.body && <p className="mt-0.5 break-words text-xs text-muted">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-muted">{new Date(n.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                <button
                  className="text-muted hover:text-ink"
                  aria-label="Dismiss"
                  onClick={() => {
                    setList((l) => l.filter((x) => x.id !== n.id));
                    start(() => dismissNotice(n.id));
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
