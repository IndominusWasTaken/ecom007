import { toCsv } from "@ecom/core/csv";
import { getSession } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { parseView } from "@/lib/params";
import { csvResponse, pnlByPeriod, pnlByStore, spFromUrl } from "@/lib/reports";

/** P&L CSV: kind=stores (one column per store + Total) or kind=periods (one row per day/week/month). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.stage !== "full") return new Response("Unauthorized", { status: 401 });
  const sp = spFromUrl(req.url);
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const stamp = `${view.range.from}_${view.range.to}`;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : Number(v.toFixed(4)));

  if (sp.kind === "periods") {
    const p = await pnlByPeriod(scope, view.range, view.currency, view.granularity);
    const headers = [view.granularity, ...p.lines.map((l) => `${l.label}${l.format === "money" ? ` (${view.currency})` : ""}`)];
    const rows = [...p.rows.map((r) => [r.period, ...p.lines.map((l) => num(r.values[l.id]))]), ["Total", ...p.lines.map((l) => num(p.total[l.id]))]];
    return csvResponse(`pnl-${view.granularity}-${stamp}.csv`, toCsv(headers, rows));
  }

  const t = await pnlByStore(scope, view.range, view.currency);
  const headers = [`Line (${view.currency})`, ...t.cols.map((c) => c.label)];
  const rows = t.lines.map((l) => [l.label, ...t.cols.map((c) => num(c.values[l.id]))]);
  return csvResponse(`pnl-stores-${stamp}.csv`, toCsv(headers, rows));
}
