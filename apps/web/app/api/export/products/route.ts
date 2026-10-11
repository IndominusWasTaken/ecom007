import { toCsv } from "@ecom/core/csv";
import { getSession } from "@/lib/auth";
import { scopeFor } from "@/lib/data";
import { parseView } from "@/lib/params";
import { csvResponse, filterAndSort, productTable, spFromUrl, type ProductStats } from "@/lib/reports";

/** Products CSV with the same view, search (q), sort/dir and by=product|variant as the page. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.stage !== "full") return new Response("Unauthorized", { status: 401 });
  const sp = spFromUrl(req.url);
  const view = parseView(sp);
  const scope = await scopeFor(view.scope);
  const byVariant = sp.by === "variant";
  const rows = filterAndSort(await productTable(scope.storeIds, view.range, view.currency), String(sp.q ?? ""), String(sp.sort ?? "netSales"), sp.dir === "asc" ? "asc" : "desc", byVariant);

  const c = view.currency;
  const r4 = (v: number | null) => (v === null ? "" : Number(v.toFixed(4)));
  const stats = (r: ProductStats) => [r.units, r4(r.netSales), r4(r.cogs), r4(r.grossMargin), r4(r.marginPct), r.refundedUnits, r4(r.refundedAmount), r4(r.refundRate), r.missingCostUnits];
  const headers = ["Store", "Product", "Variant", "SKU", "Units sold", `Net sales (${c})`, `COGS (${c})`, `Gross margin (${c})`, "Margin %", "Refunded units", `Refunded (${c})`, "Refund rate", "Units without cost"];
  const out = rows.map((p) => {
    // flat variant rows carry their product and variant titles separately
    const f = p as typeof p & { productTitle?: string; variantTitle?: string; sku?: string | null };
    return byVariant
      ? [p.store, f.productTitle, f.variantTitle, f.sku ?? "", ...stats(p)]
      : [p.store, p.title, `${p.variants.length} variant${p.variants.length === 1 ? "" : "s"}`, "", ...stats(p)];
  });
  return csvResponse(`products-${byVariant ? "variants" : "products"}-${view.range.from}_${view.range.to}.csv`, toCsv(headers, out));
}
