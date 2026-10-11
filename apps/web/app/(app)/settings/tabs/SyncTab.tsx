import Link from "next/link";
import { STALE_AFTER_MINUTES } from "@ecom/core/config";
import { adAccounts, getDb, sql, stores } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import { Empty, Section } from "../Section";
import { ago, duration, statusPill, when } from "../format";

type Run = {
  id: number;
  job: string;
  source: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  rows_changed: number;
  error: string | null;
};

const STATUSES = ["all", "ok", "error", "running"] as const;

function ErrorCell({ error }: { error: string | null }) {
  if (!error) return <span className="text-muted">—</span>;
  const first = error.split("\n")[0];
  return (
    <details className="max-w-[28rem] whitespace-normal">
      <summary className="cursor-pointer truncate text-neg">{first.slice(0, 90)}</summary>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2 text-[11px] text-muted">{error}</pre>
    </details>
  );
}

function RunsTable({ runs, label, stale }: { runs: Run[]; label: (source: string) => string; stale?: Set<string> }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Job</th>
            <th>Status</th>
            <th>Started</th>
            <th className="num">Duration</th>
            <th className="num">Rows</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className={cn(stale?.has(r.source) && "[&>td]:bg-warn-soft")}>
              <td>
                {label(r.source)}
                {stale?.has(r.source) && <span className="pill ml-2 bg-warn-soft text-warn">over {STALE_AFTER_MINUTES} min behind</span>}
              </td>
              <td className="font-mono text-xs">{r.job}</td>
              <td>
                <span className={cn("pill", statusPill(r.status))}>{r.status}</span>
              </td>
              <td className="text-xs" title={when(r.started_at)}>
                {ago(r.started_at)}
              </td>
              <td className="num text-xs">{duration(r.started_at, r.finished_at)}</td>
              <td className="num">{r.rows_changed.toLocaleString()}</td>
              <td className="text-xs">
                <ErrorCell error={r.error} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function SyncTab({ status }: { status: string }) {
  const db = getDb();
  const filter = (STATUSES as readonly string[]).includes(status) ? status : "all";
  const [storeRows, accountRows, latest, recent, recon] = await Promise.all([
    db.select({ id: stores.id, name: stores.name }).from(stores),
    db.select({ id: adAccounts.id, name: adAccounts.name }).from(adAccounts),
    db.execute<Run & { last_ok: Date | null }>(sql`
      select l.*, ok.last_ok from (
        select distinct on (source) id, job, source, status, started_at, finished_at, rows_changed, error
        from sync_runs order by source, started_at desc) l
      left join (select source, max(finished_at) last_ok from sync_runs where status = 'ok' group by source) ok using (source)
      order by l.source`),
    db.execute<Run>(sql`
      select id, job, source, status, started_at, finished_at, rows_changed, error from sync_runs
      ${filter === "all" ? sql`` : sql`where status = ${filter}`}
      order by started_at desc limit 100`),
    db.execute<{
      store_id: number;
      date: string;
      our_total_sales: string | null;
      shopify_total_sales: string | null;
      our_orders: number | null;
      shopify_orders: number | null;
      sales_gap_pct: string | null;
      orders_gap_pct: string | null;
      flagged: boolean;
      currency: string;
    }>(sql`
      select r.*, r.date::text date, s.currency from reconciliation r join stores s on s.id = r.store_id
      where r.date >= current_date - 14 order by r.date desc, s.name`),
  ]);
  const storeName = new Map(storeRows.map((s) => [s.id, s.name]));
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));

  /** "shopify:3" → store name, "meta:2" → ad account name, "meta:conn:1" → token. */
  const label = (source: string) => {
    const [kind, a, b] = source.split(":");
    if (kind === "shopify" && a) return `Shopify · ${storeName.get(Number(a)) ?? `store ${a}`}`;
    if (kind === "meta" && a === "conn") return `Meta · connection ${b}`;
    if (kind === "meta" && a) return `Meta · ${accountName.get(Number(a)) ?? `account ${a}`}`;
    if (source === "fx") return "ECB rates";
    return source.charAt(0).toUpperCase() + source.slice(1);
  };

  // only sources that feed live numbers are expected to sync at least hourly
  const stale = new Set(
    latest.rows
      .filter((r) => /^(shopify|meta):\d+$/.test(r.source))
      .filter((r) => !r.last_ok || Date.now() - new Date(r.last_ok).getTime() > STALE_AFTER_MINUTES * 60_000)
      .map((r) => r.source),
  );

  return (
    <>
      <Section title="Sources" description={`Latest run per source. Shopify stores and ad accounts turn amber when their last successful sync is more than ${STALE_AFTER_MINUTES} minutes old.`}>
        {latest.rows.length === 0 ? <Empty>No sync has run yet. Start the worker, or use the Sync buttons under Connections.</Empty> : <RunsTable runs={latest.rows} label={label} stale={stale} />}
      </Section>

      <Section title="Reconciliation" description="Our totals against Shopify’s own sales report, last 14 days. Flagged days differ by more than the tolerance and are worth a look.">
        {recon.rows.length === 0 ? (
          <Empty>No reconciliation yet. It runs nightly at 03:30 (Sofia), or via “Sync reconcile” under Connections.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Store</th>
                  <th className="num">Our sales</th>
                  <th className="num">Shopify sales</th>
                  <th className="num">Gap</th>
                  <th className="num">Our orders</th>
                  <th className="num">Shopify orders</th>
                  <th className="num">Gap</th>
                </tr>
              </thead>
              <tbody>
                {recon.rows.map((r) => (
                  <tr key={`${r.store_id}:${r.date}`} className={cn(r.flagged && "[&>td]:bg-warn-soft")}>
                    <td className="tabular">
                      {r.date}
                      {r.flagged && <span className="pill ml-2 bg-warn-soft text-warn">flagged</span>}
                    </td>
                    <td>{storeName.get(r.store_id)}</td>
                    <td className="num">{fmt(r.our_total_sales === null ? null : Number(r.our_total_sales), "money", r.currency)}</td>
                    <td className="num">{fmt(r.shopify_total_sales === null ? null : Number(r.shopify_total_sales), "money", r.currency)}</td>
                    <td className={cn("num", r.flagged && "text-warn")}>{fmt(r.sales_gap_pct === null ? null : Number(r.sales_gap_pct), "percent")}</td>
                    <td className="num">{r.our_orders ?? "—"}</td>
                    <td className="num">{r.shopify_orders ?? "—"}</td>
                    <td className="num">{fmt(r.orders_gap_pct === null ? null : Number(r.orders_gap_pct), "percent")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Recent runs"
        description="The last 100 job runs."
        actions={
          <div className="flex overflow-hidden rounded-lg border border-line text-xs font-medium">
            {STATUSES.map((s) => (
              <Link key={s} href={`/settings?tab=sync&status=${s}`} className={cn("px-3 py-1.5 capitalize", filter === s ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:bg-surface-2")}>
                {s}
              </Link>
            ))}
          </div>
        }
      >
        {recent.rows.length === 0 ? <Empty>No runs{filter !== "all" ? ` with status “${filter}”` : ""}.</Empty> : <RunsTable runs={recent.rows} label={label} />}
      </Section>
    </>
  );
}
