import "./env";
import { PgBoss } from "pg-boss";
import { BUSINESS_TZ } from "@ecom/core/config";
import { adAccounts, closeDb, getDb, sql } from "@ecom/db";
import { remapAccount } from "./meta";
import * as jobs from "./jobs";
import { log } from "./log";

/**
 * Scheduled jobs (pg-boss keeps them in Postgres; no Redis). Every queue is "exclusive":
 * one job queued or running at a time, so a slow run is never overlapped by the next tick.
 * Each job is idempotent (upserts + cursors) and safe to re-run.
 */
interface Def {
  name: string;
  cron: string;
  tz?: string;
  run: () => Promise<unknown>;
  rebuildAfter?: boolean;
}

const DEFS: Def[] = [
  { name: "shopify-history", cron: "*/15 * * * *", run: () => jobs.shopifyHistory(), rebuildAfter: true }, // no-op once loaded
  { name: "shopify-orders", cron: "*/10 * * * *", run: jobs.shopifyOrders, rebuildAfter: true },
  { name: "shopify-products", cron: "7 * * * *", run: jobs.shopifyProducts, rebuildAfter: true },
  { name: "shopify-sessions", cron: "17 * * * *", run: jobs.shopifySessions, rebuildAfter: true },
  { name: "shopify-fees", cron: "27 * * * *", run: jobs.shopifyFees, rebuildAfter: true },
  { name: "shopify-reconcile", cron: "30 3 * * *", tz: BUSINESS_TZ, run: () => jobs.shopifyReconcile() },
  { name: "meta-accounts", cron: "5 */6 * * *", run: jobs.metaAccounts },
  { name: "meta-history", cron: "*/20 * * * *", run: () => jobs.metaHistory(), rebuildAfter: true }, // no-op once loaded
  { name: "meta-structure", cron: "15 */6 * * *", run: jobs.metaStructure, rebuildAfter: true },
  { name: "meta-today", cron: "*/30 * * * *", run: jobs.metaToday, rebuildAfter: true },
  { name: "meta-trailing", cron: "0 4 * * *", tz: BUSINESS_TZ, run: jobs.metaTrailing, rebuildAfter: true },
  { name: "fx-ecb", cron: "30 17 * * *", tz: "Europe/Berlin", run: () => jobs.fxDaily("90d"), rebuildAfter: true },
  { name: "renewals", cron: "0 8 * * *", tz: BUSINESS_TZ, run: jobs.renewals, rebuildAfter: true },
  { name: "domains", cron: "0 6 * * 1", tz: BUSINESS_TZ, run: jobs.domains },
  { name: "metrics-rebuild", cron: "* * * * *", run: jobs.metricsRebuild },
  { name: "sync-monitor", cron: "*/15 * * * *", run: jobs.syncMonitor },
];

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: 3 });
  boss.on("error", (e) => log.error("pg-boss error", { error: String(e) }));
  await boss.start();
  // runs left "running" by a previous stop or crash never finished
  await getDb().execute(sql`update sync_runs set status = 'error', finished_at = now(), error = 'Interrupted (worker restarted)' where status = 'running'`);

  for (const d of DEFS) {
    await boss.createQueue(d.name, { policy: "exclusive", retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 6 * 3600 }).catch(() => undefined);
    await boss.schedule(d.name, d.cron, null, { tz: d.tz ?? "UTC" });
    await boss.work(d.name, async () => {
      const t0 = Date.now();
      try {
        await d.run();
      } finally {
        log.info("job done", { job: d.name, ms: Date.now() - t0 });
        if (d.rebuildAfter) await boss.send("metrics-rebuild", null).catch(() => undefined);
      }
    });
  }
  // Nightly backups run from Task Scheduler (infra/windows/backup.ps1); "Back up now" uses this queue.
  await boss.createQueue("backup", { policy: "exclusive" }).catch(() => undefined);
  await boss.work("backup", async () => void (await jobs.backup()));

  // on-demand queues sent by the web app (Settings → Sync now, mapping changes)
  await boss.createQueue("meta-remap", { policy: "standard" }).catch(() => undefined);
  await boss.work<{ adAccountId?: number }>("meta-remap", async ([job]) => {
    const db = getDb();
    const ids = job?.data?.adAccountId ? [job.data.adAccountId] : (await db.select({ id: adAccounts.id }).from(adAccounts)).map((a) => a.id);
    for (const id of ids) await remapAccount(db, id);
    await boss.send("metrics-rebuild", null);
  });
  await boss.createQueue("history-reload", { policy: "standard" }).catch(() => undefined);
  await boss.work<{ kind: "shopify" | "meta"; id: number }>("history-reload", async ([job]) => {
    if (job.data.kind === "shopify") await jobs.shopifyHistory(job.data.id);
    else await jobs.metaHistory(job.data.id);
    await boss.send("metrics-rebuild", null);
  });

  // first start: rates first (everything converts through them), then history
  await boss.send("fx-ecb", null);
  await boss.send("meta-accounts", null);
  await boss.send("shopify-history", null);
  log.info("worker started", { jobs: DEFS.length });

  const stop = async () => {
    log.info("worker stopping");
    await boss.stop({ graceful: true, timeout: 30_000 });
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  log.error("worker crashed", { error: String(e), stack: (e as Error).stack });
  process.exit(1);
});
