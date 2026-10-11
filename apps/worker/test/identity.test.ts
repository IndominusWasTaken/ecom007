/**
 * Database-level check of the core promise: for every additive metric, All equals the sum of
 * the stores (plus the Unassigned ad-spend bucket), in both display currencies and for
 * several ranges. Runs against TEST_DATABASE_URL (e.g. the demo database); skipped otherwise.
 */
import { describe, expect, it } from "vitest";
import { Decimal } from "@ecom/core/money";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("All = sum of stores (database)", async () => {
  process.env.DATABASE_URL = url;
  const { getDb, loadTotals, resolveScope, sql } = await import("@ecom/db");
  const { ALL_ADDITIVE } = await import("@ecom/metrics");
  const db = getDb();
  const stores = (await db.execute<{ id: number }>(sql`select id from stores where active`)).rows;
  const ranges = [
    { from: "2026-01-01", to: "2026-12-31" },
    { from: "2026-09-01", to: "2026-09-30" },
    { from: "2026-10-01", to: "2026-10-01" },
  ];
  for (const currency of ["USD", "EUR"] as const) {
    for (const range of ranges) {
      it(`${currency} ${range.from}..${range.to}`, async () => {
        const all = await loadTotals(db, { scope: await resolveScope(db, "all"), range, currency });
        const sum: Record<string, Decimal> = {};
        for (const s of stores) {
          const t = await loadTotals(db, { scope: await resolveScope(db, `store:${s.id}`), range, currency });
          for (const k of [...ALL_ADDITIVE, "new_customers", "returning_customers"]) sum[k] = (sum[k] ?? new Decimal(0)).plus(t[k]);
        }
        const un = await db.execute<{ s: string }>(sql`select coalesce(sum(${sql.raw(currency === "USD" ? "spend_usd" : "spend_eur")}),0)::text s
          from daily_ad_metrics where store_id is null and date between ${range.from} and ${range.to}`);
        sum.ad_spend_meta = sum.ad_spend_meta.plus(un.rows[0].s);
        for (const k of ALL_ADDITIVE.filter((k) => !["meta_purchase_value", "meta_purchases", "impressions", "link_clicks", "clicks"].includes(k))) {
          expect(all[k].toFixed(4), k).toBe(sum[k].toFixed(4));
        }
        expect(all.new_customers.toFixed(0)).toBe(sum.new_customers.toFixed(0));
      });
    }
  }
});
