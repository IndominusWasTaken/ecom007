import { eq, sql } from "drizzle-orm";
import { FxTable } from "@ecom/core/fx";
import type { Db } from "./client";
import { appSettings, auditLog, dirtyStoreDays, fxRates, notices, syncCursors, syncRuns } from "./schema";

// ---------- settings ----------
export interface AppSettings {
  profit_tax_rate: number; // fraction, 0 = off
  default_currency: "USD" | "EUR";
  history_months: number;
}
const DEFAULTS: AppSettings = { profit_tax_rate: 0, default_currency: "USD", history_months: 24 };

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(appSettings);
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]) {
  await db
    .insert(appSettings)
    .values({ key, value: value as unknown as object })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as unknown as object, updatedAt: new Date() } });
}

// ---------- audit ----------
export async function audit(
  db: Db,
  e: { userId?: number | null; action: string; entity?: string; entityId?: string | number; oldValue?: unknown; newValue?: unknown; ip?: string | null },
) {
  await db.insert(auditLog).values({
    userId: e.userId ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId === undefined ? undefined : String(e.entityId),
    oldValue: (e.oldValue ?? null) as object,
    newValue: (e.newValue ?? null) as object,
    ip: e.ip ?? null,
  });
}

// ---------- cursors ----------
export async function getCursor(db: Db, key: string): Promise<string | null> {
  const r = await db.select().from(syncCursors).where(eq(syncCursors.key, key));
  return r[0]?.value ?? null;
}
export async function setCursor(db: Db, key: string, value: string) {
  await db.insert(syncCursors).values({ key, value }).onConflictDoUpdate({ target: syncCursors.key, set: { value, updatedAt: new Date() } });
}

// ---------- sync runs ----------
export async function startRun(db: Db, job: string, source: string) {
  const [r] = await db.insert(syncRuns).values({ job, source }).returning({ id: syncRuns.id });
  return r.id;
}
export async function finishRun(db: Db, id: number, rowsChanged: number, detail?: unknown) {
  await db.update(syncRuns).set({ status: "ok", finishedAt: new Date(), rowsChanged, detail: (detail ?? null) as object }).where(eq(syncRuns.id, id));
}
export async function failRun(db: Db, id: number, error: unknown) {
  const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 4000) : String(error);
  await db.update(syncRuns).set({ status: "error", finishedAt: new Date(), error: msg }).where(eq(syncRuns.id, id));
}

/** Latest successful run per source, used by the "last synced" stamp. */
export async function lastSynced(db: Db) {
  const res = await db.execute<{ source: string; last_ok: Date | null; last_error: Date | null; error: string | null }>(sql`
    select source,
      max(finished_at) filter (where status = 'ok') as last_ok,
      max(finished_at) filter (where status = 'error') as last_error,
      (array_agg(error order by started_at desc) filter (where status = 'error'))[1] as error
    from sync_runs where started_at > now() - interval '7 days' group by source`);
  return res.rows;
}

// ---------- dirty store-days ----------
export async function markDirty(db: Db, storeId: number, dates: Iterable<string>) {
  const values = [...new Set(dates)].map((date) => ({ storeId, date }));
  for (let i = 0; i < values.length; i += 1000) {
    await db.insert(dirtyStoreDays).values(values.slice(i, i + 1000)).onConflictDoNothing();
  }
}

export async function markDirtyRange(db: Db, storeId: number | null, from: string, to: string) {
  await db.execute(sql`insert into dirty_store_days (store_id, date)
    select s.id, d::date from stores s, generate_series(${from}::date, ${to}::date, interval '1 day') d
    where ${storeId === null ? sql`true` : sql`s.id = ${storeId}`}
    on conflict do nothing`);
}

// ---------- fx ----------
export async function loadFx(db: Db): Promise<FxTable> {
  const rows = await db.select().from(fxRates);
  const map = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const m = map.get(r.date) ?? {};
    m[r.currency] = r.perEur;
    map.set(r.date, m);
  }
  return new FxTable(map);
}

// ---------- notices ----------
export async function notify(db: Db, n: { kind: string; severity?: "info" | "warning" | "error"; title: string; body?: string; link?: string; dedupeKey?: string }) {
  await db
    .insert(notices)
    .values({ kind: n.kind, severity: n.severity ?? "info", title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey })
    .onConflictDoNothing();
}

// ---------- upsert helper ----------
import { getTableColumns, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** `set` clause for ON CONFLICT DO UPDATE that takes every column from EXCLUDED except the keys. */
export function excludedSet<T extends PgTable>(table: T, keep: string[]): Record<string, SQL> {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(Object.entries(cols).filter(([k]) => !keep.includes(k)).map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]));
}
