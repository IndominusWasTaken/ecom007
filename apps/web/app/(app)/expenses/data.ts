import "server-only";
import { getDb, listStoresAndRegions, loadFx } from "@ecom/db";
import { today } from "@/lib/forms";
import type { StoreOpt } from "./client";

export async function storeOpts(): Promise<StoreOpt[]> {
  const rows = await listStoresAndRegions(getDb());
  return rows.filter((r) => r.active).map((r) => ({ id: r.store_id, name: r.store_name, regionId: r.region_id, regionName: r.region_name }));
}

/** Converter into the display currency: on the charge date for dated amounts, latest rate otherwise. */
export async function converter(target: "USD" | "EUR") {
  const fx = await loadFx(getDb());
  const t = today();
  return (amount: number | string, from: string, date: string = t) => {
    try {
      return fx.convert(amount, from, target, date > t ? t : date).toNumber();
    } catch {
      return NaN; // no rate for that currency; shown as "—"
    }
  };
}
