import { toCsv } from "@ecom/core/csv";
import { getDb, sql } from "@ecom/db";
import { getSession } from "@/lib/auth";
import { today } from "@/lib/forms";

/** ?kind=template: an import template pre-filled with every catalog SKU. ?kind=current: costs in force today. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.stage !== "full") return new Response("Unauthorized", { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind") === "template" ? "template" : "current";
  const t = today();
  const db = getDb();

  let body: string;
  if (kind === "template") {
    const res = await db.execute<{ store: string; sku: string; currency: string }>(sql`
      select st.shop_domain store, v.sku, st.currency from variants v join stores st on st.id = v.store_id
      where v.sku is not null and v.sku <> '' order by st.id, v.sku`);
    body = toCsv(
      ["store", "sku", "cost", "currency", "effective_from"],
      res.rows.map((r) => [r.store, r.sku, "", r.currency, t]),
    );
  } else {
    // latest typed row on or before today per catalog variant (matched by variant id or SKU, as the engine does)
    const res = await db.execute<{ store: string; sku: string | null; product: string | null; variant: string | null; shopify_cost: string | null; cost: string | null; currency: string | null; effective_from: string | null; source: string | null }>(sql`
      select st.shop_domain store, v.sku, p.title product, v.title variant, v.shopify_cost::text shopify_cost, c.cost::text cost, c.currency, c.effective_from::text effective_from, c.source
      from variants v
      join stores st on st.id = v.store_id
      left join products p on p.store_id = v.store_id and (p.id = v.product_id or p.shopify_id = v.product_shopify_id)
      left join lateral (
        select cost, currency, effective_from, source from variant_costs c
        where c.store_id = v.store_id and c.effective_from <= ${t}
          and (c.variant_shopify_id = v.shopify_id or (v.sku is not null and lower(c.sku) = lower(v.sku)))
        order by c.effective_from desc, c.id desc limit 1) c on true
      order by st.id, p.title, v.title`);
    body = toCsv(
      ["store", "sku", "cost", "currency", "effective_from", "source", "product", "variant", "shopify_cost"],
      res.rows.map((r) => [r.store, r.sku, r.cost ? Number(r.cost) : "", r.currency, r.effective_from, r.source, r.product, r.variant, r.shopify_cost ? Number(r.shopify_cost) : ""]),
    );
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind === "template" ? "cost-import-template" : `costs-${t}`}.csv"`,
    },
  });
}
