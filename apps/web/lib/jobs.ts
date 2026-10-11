import "server-only";
import { PgBoss } from "pg-boss";

/**
 * The web app never calls Shopify or Meta itself: it asks the worker by queueing a job.
 * Queue names match apps/worker/src/main.ts. Store-day rebuilds need no job: mark the days
 * dirty (markDirty / markDirtyRange from @ecom/db) and the minute-ly rebuild picks them up.
 */
export const QUEUES = [
  "shopify-orders",
  "shopify-products",
  "shopify-sessions",
  "shopify-fees",
  "shopify-reconcile",
  "shopify-history",
  "meta-accounts",
  "meta-structure",
  "meta-today",
  "meta-trailing",
  "meta-history",
  "fx-ecb",
  "renewals",
  "domains",
  "metrics-rebuild",
  "backup",
  "meta-remap",
  "history-reload",
] as const;
export type QueueName = (typeof QUEUES)[number];

let boss: PgBoss | null = null;
let starting: Promise<void> | null = null;

async function client() {
  if (!boss) {
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: 1, supervise: false, schedule: false });
    boss.on("error", () => undefined);
    starting = boss.start().then(() => undefined);
  }
  await starting;
  return boss;
}

export async function enqueue(name: QueueName, data: object | null = null) {
  const b = await client();
  return b.send(name, data);
}
