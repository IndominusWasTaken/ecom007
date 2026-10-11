import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// numeric -> string (exact), int8 -> number, date -> "YYYY-MM-DD"
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

let _pool: pg.Pool | null = null;
let _db: Db | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 5), idleTimeoutMillis: 30_000 });
  }
  return _pool;
}

export function getDb(): Db {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

export async function closeDb() {
  await _pool?.end();
  _pool = null;
  _db = null;
}
