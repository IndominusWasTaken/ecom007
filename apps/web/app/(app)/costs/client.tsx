"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

/** A table row with a toggle that opens a full-width detail row underneath (history + edit form). */
export function ExpandableRow({ cells, detail, colSpan, label = "History" }: { cells: React.ReactNode; detail: React.ReactNode; colSpan: number; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr>
        {cells}
        <td>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {label}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={colSpan} className="!whitespace-normal bg-surface-2">
            {detail}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

type Row = { country: string; basis: "weight" | "items"; min: string; max: string; amount: string };

/** Rate-table editor for table-mode shipping rules; posts the rows as JSON in a hidden "table" field. */
export function ShippingTableEditor({ initial }: { initial?: Row[] }) {
  const [mode, setMode] = useState<"flat" | "table" | "actual">("flat");
  const [rows, setRows] = useState<Row[]>(initial?.length ? initial : [{ country: "*", basis: "weight", min: "0", max: "", amount: "" }]);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex basis-full flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          <span className="label">Mode</span>
          <select name="mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="flat">Flat per order</option>
            <option value="table">Rate table</option>
            <option value="actual">Actual (CSV import)</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label">{mode === "flat" ? "Amount per order" : "Default when nothing matches"}</span>
          <input name="flatAmount" className="input w-32" inputMode="decimal" placeholder="0.00" />
        </label>
      </div>
      {mode === "actual" && <p className="text-xs text-muted">Orders use the imported carrier cost; orders without an import use the default amount above.</p>}
      {mode === "table" && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <input type="hidden" name="table" value={JSON.stringify(rows)} />
          <table className="table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Basis</th>
                <th>Min</th>
                <th>Max</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input className="input w-16" value={r.country} onChange={(e) => set(i, { country: e.target.value })} placeholder="*" aria-label="Country" />
                  </td>
                  <td>
                    <select className="input" value={r.basis} onChange={(e) => set(i, { basis: e.target.value as Row["basis"] })} aria-label="Basis">
                      <option value="weight">Weight (g)</option>
                      <option value="items">Items</option>
                    </select>
                  </td>
                  <td>
                    <input className="input w-20" inputMode="numeric" value={r.min} onChange={(e) => set(i, { min: e.target.value })} aria-label="Min" />
                  </td>
                  <td>
                    <input className="input w-20" inputMode="numeric" value={r.max} onChange={(e) => set(i, { max: e.target.value })} placeholder="none" aria-label="Max" />
                  </td>
                  <td>
                    <input className="input w-24" inputMode="decimal" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="0.00" aria-label="Amount" />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove row">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2 border-t border-line p-2">
            <span className="text-xs text-muted">Country-specific rows win over “*”. Min/max are inclusive; blank max = no upper limit.</span>
            <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { country: "*", basis: rows[rows.length - 1]?.basis ?? "weight", min: "", max: "", amount: "" }])}>
              <Plus size={12} /> Row
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
