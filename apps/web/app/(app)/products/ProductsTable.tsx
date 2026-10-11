"use client";
import { Fragment, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { fmt, type Fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";

export interface Stats {
  units: number;
  netSales: number;
  cogs: number;
  grossMargin: number;
  marginPct: number | null;
  refundedUnits: number;
  refundedAmount: number;
  refundRate: number | null;
  missingCostUnits: number;
}
export interface Row extends Stats {
  key: string;
  title: string;
  sku?: string | null;
  store?: string;
  variants: (Stats & { key: string; title: string; sku: string | null })[];
}
export interface Column {
  id: string;
  label: string;
  format: Fmt | null;
  href: string;
  active: "asc" | "desc" | null;
}

function Cells({ r, cols, currency }: { r: Stats; cols: Column[]; currency: string }) {
  return (
    <>
      {cols.slice(1).map((c) => {
        const v = r[c.id as keyof Stats];
        return (
          <td key={c.id} className={cn("num", (c.id === "grossMargin" || c.id === "marginPct") && v !== null && v < 0 && "text-neg")}>
            {fmt(v, c.format ?? "number", currency)}
          </td>
        );
      })}
    </>
  );
}

function MissingCost({ units }: { units: number }) {
  if (!units) return null;
  return (
    <span className="pill ml-2 gap-1 bg-warn-soft text-warn" title={`${units} unit(s) sold without a unit cost: COGS is understated and margin overstated.`}>
      <AlertTriangle size={11} /> cost missing
    </span>
  );
}

/** Product rows expand to their variants; in variant mode rows are already flat. */
export function ProductsTable({ rows, cols, currency, showStore, expandable }: { rows: Row[]; cols: Column[]; currency: string; showStore: boolean; expandable: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <table className="table">
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={c.id} className={cn(i > 0 && "num text-right!")}>
              <a href={c.href} className={cn("inline-flex items-center gap-1 hover:text-ink", c.active && "text-ink")}>
                {c.label}
                {c.active === "asc" && <ArrowUp size={12} />}
                {c.active === "desc" && <ArrowDown size={12} />}
              </a>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const canExpand = expandable && r.variants.length > 1;
          const isOpen = open.has(r.key);
          // a single-variant product shows that variant's title and SKU so same-named products can be told apart
          const only = expandable && r.variants.length === 1 ? r.variants[0] : null;
          const sub = [
            showStore && r.store,
            only && only.title !== "Default" && only.title,
            (r.sku ?? only?.sku) && `SKU ${r.sku ?? only?.sku}`,
            expandable && r.variants.length > 1 && `${r.variants.length} variants`,
          ].filter(Boolean);
          return (
            <Fragment key={r.key}>
              <tr className={cn(canExpand && "cursor-pointer")} onClick={canExpand ? () => toggle(r.key) : undefined}>
                <td className="max-w-[340px]">
                  <div className="flex items-center gap-1">
                    {expandable && (
                      <ChevronRight size={14} className={cn("shrink-0 text-muted transition-transform", isOpen && "rotate-90", !canExpand && "invisible")} aria-hidden />
                    )}
                    <span className="truncate font-medium" title={r.title}>
                      {r.title}
                    </span>
                    <MissingCost units={r.missingCostUnits} />
                  </div>
                  {sub.length > 0 && <div className={cn("truncate text-xs text-muted", expandable && "pl-[18px]")}>{sub.join(" · ")}</div>}
                </td>
                <Cells r={r} cols={cols} currency={currency} />
              </tr>
              {canExpand &&
                isOpen &&
                r.variants.map((v) => (
                  <tr key={v.key} className="bg-surface-2/50 text-[13px]">
                    <td className="max-w-[340px] pl-10">
                      <span className="truncate">{v.title}</span>
                      {v.sku && <span className="ml-2 text-xs text-muted">{v.sku}</span>}
                      <MissingCost units={v.missingCostUnits} />
                    </td>
                    <Cells r={v} cols={cols} currency={currency} />
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
