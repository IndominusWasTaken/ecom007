import { AD_PLATFORMS } from "@ecom/connectors";
import { adAccounts, connections, eq, getDb, stores } from "@ecom/db";
import { reloadHistory, replaceShopifyCredentials, saveMetaToken, syncNow, testMeta, testShopify } from "../actions";
import { ActionForm, Submit } from "../ui";
import { Empty, Field, Section } from "../Section";
import { statusPill, when } from "../format";
import { cn } from "@/lib/cn";

type Conn = typeof connections.$inferSelect;

const SHOPIFY_SYNCS = [
  ["shopify-orders", "Orders"],
  ["shopify-products", "Products & costs"],
  ["shopify-sessions", "Sessions"],
  ["shopify-fees", "Payment fees"],
  ["shopify-reconcile", "Reconcile"],
] as const;

const META_SYNCS = [
  ["meta-today", "Today’s spend"],
  ["meta-structure", "Campaigns & creatives"],
  ["meta-trailing", "Trailing 28 days"],
] as const;

/** Connection facts that are safe to show: never secrets, only a 4-char hint. */
function ConnectionFacts({ conn, keyLabel, hint }: { conn: Conn | null; keyLabel: string; hint?: string }) {
  if (!conn) return <p className="text-sm text-warn">Not connected — add credentials.</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
      <dt className="text-muted">Status</dt>
      <dd>
        <span className={cn("pill", statusPill(conn.status))}>{conn.status}</span>
      </dd>
      <dt className="text-muted">{keyLabel}</dt>
      <dd className="font-mono">{hint ? `••••${hint}` : "—"}</dd>
      <dt className="text-muted">Last checked</dt>
      <dd>{when(conn.lastCheckedAt)}</dd>
      <dt className="text-muted">Access token expires</dt>
      <dd>{conn.tokenExpiresAt ? when(conn.tokenExpiresAt) : "—"}</dd>
      {conn.lastError && (
        <>
          <dt className="text-muted">Last error</dt>
          <dd className="col-span-1 whitespace-pre-wrap break-words text-neg sm:col-span-3">{conn.lastError.slice(0, 500)}</dd>
        </>
      )}
    </dl>
  );
}

function SyncButtons({ jobs, disabled }: { jobs: readonly (readonly [string, string])[]; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {jobs.map(([queue, label]) => (
        <ActionForm key={queue} action={syncNow} inline>
          <input type="hidden" name="queue" value={queue} />
          <button className="btn btn-sm" disabled={disabled}>
            Sync {label.toLowerCase()}
          </button>
        </ActionForm>
      ))}
    </div>
  );
}

export async function ConnectionsTab() {
  const db = getDb();
  const [storeRows, conns, accounts] = await Promise.all([
    db.select().from(stores).orderBy(stores.name),
    db.select().from(connections).orderBy(connections.id),
    db.select().from(adAccounts).where(eq(adAccounts.platform, "meta")).orderBy(adAccounts.name),
  ]);
  const metaConn = conns.find((c) => c.platform === "meta") ?? null;
  const anyShopify = conns.some((c) => c.platform === "shopify" && c.secretsEnc);

  return (
    <>
      <Section
        title="Shopify"
        description="One custom app per store (client credentials). Secrets are stored encrypted and never shown again. Sync jobs run for every active store."
        actions={<SyncButtons jobs={SHOPIFY_SYNCS} disabled={!anyShopify} />}
      >
        {storeRows.length === 0 && <Empty>No stores yet. Add one under Stores &amp; regions.</Empty>}
        <div className="grid gap-3 lg:grid-cols-2">
          {storeRows.map((s) => {
            const conn = conns.find((c) => c.platform === "shopify" && c.storeId === s.id) ?? null;
            const hint = conn ? (conn.config.clientIdHint ?? conn.config.clientId?.slice(-4)) : undefined;
            return (
              <div key={s.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{s.name}</h3>
                  <span className="font-mono text-xs text-muted">{s.shopDomain}</span>
                  {!s.active && <span className="pill bg-surface-2 text-muted">Inactive</span>}
                </div>
                <ConnectionFacts conn={conn} keyLabel="Client ID" hint={hint} />
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={testShopify} inline>
                    <input type="hidden" name="storeId" value={s.id} />
                    <Submit className="btn-sm">Test connection</Submit>
                  </ActionForm>
                  <ActionForm action={reloadHistory} inline confirm={`Reload all order history for ${s.name}? This re-reads every order from Shopify.`}>
                    <input type="hidden" name="kind" value="shopify" />
                    <input type="hidden" name="id" value={s.id} />
                    <Submit className="btn-sm">Reload history</Submit>
                  </ActionForm>
                </div>
                <details className="group rounded-lg border border-line px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">{conn ? "Replace credentials" : "Add credentials"}</summary>
                  <ActionForm action={replaceShopifyCredentials} reset className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <input type="hidden" name="storeId" value={s.id} />
                    <Field label="Client ID">
                      <input name="clientId" className="input w-full" required autoComplete="off" spellCheck={false} />
                    </Field>
                    <Field label="Client secret">
                      <input name="clientSecret" type="password" className="input w-full" required autoComplete="new-password" />
                    </Field>
                    <Submit variant="primary">Save</Submit>
                  </ActionForm>
                </details>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Meta"
        description="One System User token with ads_read for every ad account. Discovered accounts appear under Ad account mapping."
        actions={
          <>
            <ActionForm action={syncNow} inline>
              <input type="hidden" name="queue" value="meta-accounts" />
              <button className="btn btn-sm" disabled={!metaConn?.secretsEnc}>
                Discover ad accounts
              </button>
            </ActionForm>
            <SyncButtons jobs={META_SYNCS} disabled={!metaConn?.secretsEnc} />
          </>
        }
      >
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{metaConn?.label ?? "Meta · System User"}</h3>
          </div>
          <ConnectionFacts conn={metaConn} keyLabel="Token" hint={metaConn?.config.tokenHint} />
          {metaConn && (
            <ActionForm action={testMeta} inline>
              <Submit className="btn-sm">Test token</Submit>
            </ActionForm>
          )}
          <details className="rounded-lg border border-line px-3 py-2" open={!metaConn}>
            <summary className="cursor-pointer text-sm font-medium">{metaConn ? "Replace token" : "Add token"}</summary>
            <ActionForm action={saveMetaToken} reset className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="System User access token">
                <input name="token" type="password" className="input w-full" required autoComplete="new-password" />
              </Field>
              <Submit variant="primary">Save token</Submit>
            </ActionForm>
          </details>
          {accounts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ad account</th>
                    <th>History</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.name} <span className="font-mono text-xs text-muted">{a.externalId}</span>
                      </td>
                      <td className="text-xs">{a.historyLoadedAt ? `Loaded ${when(a.historyLoadedAt)}` : <span className="text-warn">Not loaded</span>}</td>
                      <td className="text-right">
                        <ActionForm action={reloadHistory} inline confirm={`Reload ad history for ${a.name}?`}>
                          <input type="hidden" name="kind" value="meta" />
                          <input type="hidden" name="id" value={a.id} />
                          <button className="btn btn-sm" disabled={!metaConn?.secretsEnc}>
                            Reload history
                          </button>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      <Section title="Other ad platforms" description="Each platform is a connector; new ones appear here when they are built.">
        <div className="flex flex-wrap gap-2">
          {AD_PLATFORMS.filter((p) => p.platform !== "meta").map((p) => (
            <button key={p.platform} className="btn" disabled={!p.available} title={p.available ? undefined : "Coming soon"}>
              {p.label}
              {!p.available && <span className="pill bg-surface-2 text-muted">Coming soon</span>}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}
