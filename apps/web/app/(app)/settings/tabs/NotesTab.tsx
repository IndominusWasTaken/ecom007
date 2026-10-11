import { Trash2 } from "lucide-react";
import { todayIn } from "@ecom/core/dates";
import { BUSINESS_TZ } from "@ecom/core/config";
import { getDb, sql } from "@ecom/db";
import { addChartNote, deleteChartNote } from "../../actions";
import { Field, Section } from "../Section";
import { when } from "../format";

export async function NotesTab() {
  const db = getDb();
  const [notes, storeRows] = await Promise.all([
    db.execute<{ id: number; date: string; text: string; store_name: string | null; author: string | null; created_at: Date }>(sql`
      select n.id, n.date::text date, n.text, s.name store_name, coalesce(u.display_name, u.username) author, n.created_at
      from chart_notes n left join stores s on s.id = n.store_id left join users u on u.id = n.created_by
      order by n.date desc, n.id desc`),
    db.execute<{ id: number; name: string }>(sql`select id, name from stores order by name`),
  ]);

  return (
    <Section title="Chart notes" description="Short notes (price change, new offer, site outage) drawn as markers on every time chart for that date. A note for one store shows only when that store is in scope.">
      <form action={addChartNote} className="card mb-3 grid gap-3 p-4 sm:grid-cols-[10rem_1fr_12rem_auto] sm:items-end">
        <Field label="Date">
          <input name="date" type="date" defaultValue={todayIn(BUSINESS_TZ)} className="input w-full" required />
        </Field>
        <Field label="Note">
          <input name="text" maxLength={255} className="input w-full" placeholder="Raised serum price to $39" required />
        </Field>
        <Field label="Store">
          <select name="storeId" className="input w-full" defaultValue="">
            <option value="">All stores</option>
            {storeRows.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn btn-primary">Add note</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Note</th>
              <th>Store</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {notes.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  No notes yet.
                </td>
              </tr>
            )}
            {notes.rows.map((n) => (
              <tr key={n.id}>
                <td className="tabular">{n.date}</td>
                <td className="whitespace-normal">{n.text}</td>
                <td>{n.store_name ?? <span className="text-muted">All stores</span>}</td>
                <td className="text-xs text-muted">
                  {n.author ?? "seed"} · {when(n.created_at)}
                </td>
                <td className="text-right">
                  <form action={deleteChartNote.bind(null, n.id)}>
                    <button className="btn btn-sm btn-danger" aria-label={`Delete note ${n.text}`}>
                      <Trash2 size={13} />
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
