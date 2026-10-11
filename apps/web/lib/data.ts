import "server-only";
import { cache } from "react";
import { getDb, getSettings, lastSynced, listStoresAndRegions, resolveScope, sql } from "@ecom/db";
import { STALE_AFTER_MINUTES } from "@ecom/core/config";

export const db = () => getDb();

export const storesAndRegions = cache(async () => listStoresAndRegions(getDb()));
export const settings = cache(async () => getSettings(getDb()));
export const scopeFor = cache(async (key: string) => resolveScope(getDb(), key));

export interface SyncStamp {
  at: Date | null;
  stale: boolean;
  errors: { source: string; error: string | null }[];
}

/** Oldest "last success" across the sources that feed numbers; amber when > 1 h behind. */
export const syncStamp = cache(async (): Promise<SyncStamp> => {
  const rows = await lastSynced(getDb());
  const live = rows.filter((r) => /^(shopify|meta):\d+$/.test(r.source));
  const oks = live.map((r) => (r.last_ok ? new Date(r.last_ok) : null));
  const at = oks.length && oks.every(Boolean) ? new Date(Math.min(...oks.map((d) => d!.getTime()))) : (oks.find(Boolean) ?? null);
  const stale = !at || Date.now() - at.getTime() > STALE_AFTER_MINUTES * 60_000;
  const errors = live.filter((r) => r.last_error && (!r.last_ok || new Date(r.last_error) > new Date(r.last_ok))).map((r) => ({ source: r.source, error: r.error }));
  return { at, stale, errors };
});

export const openNotices = cache(async () => {
  const res = await getDb().execute<{ id: number; kind: string; severity: string; title: string; body: string | null; link: string | null; created_at: Date }>(
    sql`select id, kind, severity, title, body, link, created_at from notices where dismissed_at is null order by created_at desc limit 50`,
  );
  return res.rows;
});

export const chartNotesIn = cache(async (from: string, to: string, storeIds: number[]) => {
  const res = await getDb().execute<{ date: string; text: string }>(
    sql`select date::text, text from chart_notes where date between ${from} and ${to}
        and (store_id is null or store_id = any(${sql.param(storeIds)}::int[])) order by date`,
  );
  return res.rows;
});

export function evalCtx(s: { profit_tax_rate: number }) {
  return { profitTaxRate: Number(s.profit_tax_rate) || 0 };
}
