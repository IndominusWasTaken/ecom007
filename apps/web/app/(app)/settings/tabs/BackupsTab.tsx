import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDb, sql } from "@ecom/db";
import { cn } from "@/lib/cn";
import { syncNow } from "../actions";
import { ActionForm, Submit } from "../ui";
import { Empty, Section } from "../Section";
import { ago, bytes, duration, statusPill, when } from "../format";

/**
 * The worker writes backups to BACKUP_DIR (default ./backups in the worker's directory).
 * The web app only lists the folder when it can see it.
 */
async function listBackups() {
  const configured = process.env.BACKUP_DIR;
  const candidates = configured ? [resolve(configured)] : [resolve("backups"), resolve("../worker/backups")];
  for (const dir of candidates) {
    try {
      const names = (await readdir(dir)).filter((f) => f.endsWith(".enc"));
      const files = await Promise.all(names.map(async (name) => ({ name, ...(await stat(join(dir, name)).then((s) => ({ size: s.size, mtime: s.mtime }))) })));
      return { dir, configured: !!configured, found: true, files: files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) };
    } catch {
      /* not there: try the next */
    }
  }
  return { dir: configured ?? "./backups (worker directory)", configured: !!configured, found: false, files: [] };
}

export async function BackupsTab() {
  const [backups, runs] = await Promise.all([
    listBackups(),
    getDb().execute<{ id: number; status: string; started_at: Date; finished_at: Date | null; error: string | null }>(
      sql`select id, status, started_at, finished_at, error from sync_runs where job = 'backup' order by started_at desc limit 1`,
    ),
  ]);
  const last = runs.rows[0];

  return (
    <>
      <Section
        title="Backups"
        description="Every night at 02:30 (Sofia) the worker writes an encrypted pg_dump to the backup folder and removes files older than the retention period. Keep that folder on storage off the server."
        actions={
          <ActionForm action={syncNow} inline>
            <input type="hidden" name="queue" value="backup" />
            <Submit className="btn-sm" variant="primary">
              Back up now
            </Submit>
          </ActionForm>
        }
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <div className="text-xs text-muted">Backup folder (BACKUP_DIR)</div>
            <div className="mt-1 break-all font-mono text-sm">{backups.dir}</div>
            {!backups.configured && <div className="mt-1 text-xs text-warn">BACKUP_DIR is not set; the worker uses its default folder.</div>}
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted">Last backup run</div>
            {last ? (
              <>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className={cn("pill", statusPill(last.status))}>{last.status}</span>
                  {when(last.started_at)} · {duration(last.started_at, last.finished_at)}
                </div>
                {last.error && <div className="mt-1 line-clamp-3 text-xs text-neg">{last.error}</div>}
              </>
            ) : (
              <div className="mt-1 text-sm text-warn">No backup has run yet.</div>
            )}
          </div>
        </div>
        {!backups.found ? (
          <Empty>The backup folder is not visible from the web app (or is empty). Backups are listed here once it exists on this machine.</Empty>
        ) : backups.files.length === 0 ? (
          <Empty>No backup files yet.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="num">Size</th>
                  <th>Written</th>
                </tr>
              </thead>
              <tbody>
                {backups.files.map((f) => (
                  <tr key={f.name}>
                    <td className="font-mono text-xs">{f.name}</td>
                    <td className="num">{bytes(f.size)}</td>
                    <td className="text-xs" title={when(f.mtime)}>
                      {when(f.mtime)} <span className="text-muted">({ago(f.mtime)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Restore" description="Restoring is done on the server, never from the browser. Full steps are in docs/OPERATIONS.md (“Restore a backup”).">
        <div className="card space-y-2 p-4 text-sm">
          <p>1. Restore into a scratch database first to check the file:</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
            {"createdb -U postgres ecom_restore\npnpm --filter @ecom/worker cli restore <file> --target-db postgres://…/ecom_restore"}
          </pre>
          <p>2. To replace production: stop the web and worker services, run the same command against the main database, then start them again.</p>
          <p className="text-xs text-muted">Without --target-db the command only decrypts the file to a plain pg_dump. Restoring needs BACKUP_ENCRYPTION_KEY from the server’s .env — keep a copy of it somewhere safe.</p>
        </div>
      </Section>
    </>
  );
}
