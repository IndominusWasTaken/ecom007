import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths } from "@ecom/core/dates";
import { getDb } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { today } from "@/lib/forms";
import { chargesBetween, type Charge } from "@/lib/expenseCalendar";
import { withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/cn";
import { converter } from "./data";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month grid of every charge (renewals and one-offs); a day list replaces the grid on phones. */
export async function CalendarTab({ currency, month, sp }: { currency: "USD" | "EUR"; month: string; sp: SearchParams }) {
  const t = today();
  const first = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : `${t.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const db = getDb();
  const [charges, upcoming, conv] = await Promise.all([chargesBetween(db, first, last), chargesBetween(db, t, addDays(t, 29)), converter(currency)]);

  const disp = (c: Charge) => (c.trial ? 0 : conv(c.amount, c.currency, c.date));
  const byDay = new Map<string, Charge[]>();
  for (const c of charges) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);
  const monthTotal = charges.reduce((a, c) => a + disp(c), 0);
  const next30 = upcoming.reduce((a, c) => a + disp(c), 0);

  // grid starts on the Monday on/before the 1st and ends on the Sunday on/after the last day
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  const trail = 6 - ((new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7);
  const end = addDays(last, trail);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  const label = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const nav = (m: string) => withParams("/expenses", sp, { tab: "calendar", month: m.slice(0, 7) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={nav(addMonths(first, -1))} className="btn w-9 px-0" aria-label="Previous month">
            <ChevronLeft size={16} />
          </Link>
          <h2 className="min-w-[9rem] text-center font-semibold">{label}</h2>
          <Link href={nav(addMonths(first, 1))} className="btn w-9 px-0" aria-label="Next month">
            <ChevronRight size={16} />
          </Link>
          {first.slice(0, 7) !== t.slice(0, 7) && (
            <Link href={nav(t)} className="btn btn-sm">
              Today
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            <span className="text-muted">Month total </span>
            <strong className="tabular-nums">{fmt(monthTotal, "money", currency)}</strong>
          </span>
          <span>
            <span className="text-muted">Next 30 days </span>
            <strong className="tabular-nums">{fmt(next30, "money", currency)}</strong>
          </span>
        </div>
      </div>

      {/* grid: tablet and up */}
      <div className="card hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2 text-xs font-medium text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-1.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d >= first && d <= last;
            const total = list.reduce((a, c) => a + disp(c), 0);
            return (
              <div
                key={d}
                className={cn("flex min-h-28 min-w-0 flex-col gap-1 border-line p-1.5", i % 7 !== 6 && "border-r", i < days.length - 7 && "border-b", !inMonth && "bg-surface-2/50 text-muted")}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className={cn("tabular-nums", d === t && "rounded-full bg-accent px-1.5 font-semibold text-accent-ink")}>{Number(d.slice(8))}</span>
                  {total > 0 && <span className="tabular-nums font-medium">{fmt(total, "money", currency, true)}</span>}
                </div>
                {inMonth && list.map((c, k) => <ChargeChip key={k} c={c} past={d < t} />)}
              </div>
            );
          })}
        </div>
      </div>

      {/* list: phones */}
      <div className="flex flex-col gap-2 md:hidden">
        {[...byDay.keys()].length === 0 && <p className="card p-4 text-sm text-muted">No charges this month.</p>}
        {[...byDay.entries()].map(([d, list]) => (
          <div key={d} className={cn("card p-3", d === t && "border-accent")}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium">{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
              <span className="tabular-nums font-medium">{fmt(list.reduce((a, c) => a + disp(c), 0), "money", currency)}</span>
            </div>
            <div className="flex flex-col gap-1">
              {list.map((c, k) => (
                <ChargeChip key={k} c={c} past={d < t} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Past renewals show the logged amount (corrected if you fixed it in the renewal log); future ones the current price. Trials are shown but cost nothing until they convert.</p>
    </div>
  );
}

function ChargeChip({ c, past }: { c: Charge; past: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1 rounded-md px-1.5 py-0.5 text-xs",
        c.kind === "expense" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent",
        c.trial && "bg-surface-2 text-muted line-through",
        past && "opacity-80",
      )}
      title={`${c.name} · ${fmt(c.amount, "money", c.currency)}${c.kind === "expense" ? " · one-off" : ""}${c.trial ? " · trial" : ""}`}
    >
      <span className="min-w-0 truncate">{c.name}</span>
      <span className="shrink-0 tabular-nums">{fmt(c.amount, "money", c.currency, true)}</span>
    </div>
  );
}
