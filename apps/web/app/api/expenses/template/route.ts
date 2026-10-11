import { toCsv } from "@ecom/core/csv";
import { getDb, listStoresAndRegions } from "@ecom/db";
import { getSession } from "@/lib/auth";
import { today } from "@/lib/forms";

/** Example file for the one-off expense CSV import, using your own store and region names. */
export async function GET() {
  const s = await getSession();
  if (!s || s.stage !== "full") return new Response("Unauthorized", { status: 401 });
  const t = today();
  const sr = await listStoresAndRegions(getDb());
  const body = toCsv(
    ["date", "name", "amount", "currency", "category", "scope", "store_or_region"],
    [
      [t, "Sample order", "48.90", "USD", "other", "store", sr[0]?.store_name ?? "My store"],
      [t, "Product photo shoot", "250.00", "EUR", "contractors", "region", sr[0]?.region_code ?? "us"],
      [t, "Accounting", "120.00", "EUR", "other", "shared", ""],
    ],
  );
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="expenses-template.csv"' } });
}
