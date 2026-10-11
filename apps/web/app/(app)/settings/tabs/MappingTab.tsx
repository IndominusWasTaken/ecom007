import { AlertTriangle, Trash2 } from "lucide-react";
import { addDays, todayIn } from "@ecom/core/dates";
import { BUSINESS_TZ } from "@ecom/core/config";
import { mapCampaignToStore } from "@ecom/metrics";
import { adAccounts, campaignStoreRules, getDb, getSettings, sql, stores } from "@ecom/db";
import { fmt } from "@/components/charts/format";
import { cn } from "@/lib/cn";
import { addCampaignRule, deleteCampaignRule, setAccountEnabled, setAccountStore } from "../actions";
import { ActionForm, AutoCheckbox, AutoSelect, RuleForm } from "../ui";
import { Empty, Section } from "../Section";
import { when } from "../format";

const ACCOUNT_STATUS: Record<number, string> = {
  1: "Active",
  2: "Disabled",
  3: "Unsettled",
  7: "Risk review",
  8: "Pending settlement",
  9: "Grace period",
  100: "Pending closure",
  101: "Closed",
};

export async function MappingTab() {
  const db = getDb();
  const settings = await getSettings(db);
  const cur = settings.default_currency;
  const spendCol = sql.raw(cur === "EUR" ? "spend_eur" : "spend_usd");
  const since = addDays(todayIn(BUSINESS_TZ), -29);

  const [accounts, storeRows, rules, campaignRows, unassigned] = await Promise.all([
    db.select().from(adAccounts).orderBy(adAccounts.name),
    db.select({ id: stores.id, name: stores.name, timeZone: stores.timeZone, active: stores.active }).from(stores).orderBy(stores.name),
    db.select().from(campaignStoreRules).orderBy(campaignStoreRules.priority, campaignStoreRules.id),
    db.execute<{ id: number; ad_account_id: number; external_id: string; name: string; effective_status: string | null; store_id: number | null; spend: string }>(sql`
      select c.id, c.ad_account_id, c.external_id, c.name, c.effective_status, c.store_id,
        coalesce((select sum(${spendCol}) from daily_ad_metrics d where d.campaign_id = c.id and d.date >= ${since}), 0) spend
      from campaigns c order by spend desc, c.name`),
    db.execute<{ spend: string; campaigns: number }>(sql`
      select coalesce(sum(${spendCol}), 0) spend, count(distinct campaign_id)::int campaigns
      from daily_ad_metrics where store_id is null and date >= ${since}`),
  ]);
  const storeName = new Map(storeRows.map((s) => [s.id, s.name]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const campaignName = new Map(campaignRows.rows.map((c) => [`${c.ad_account_id}:${c.external_id}`, c.name]));
  const unassignedSpend = Number(unassigned.rows[0]?.spend ?? 0);
  const ruleInput = rules.map((r) => ({ adAccountId: r.adAccountId, campaignId: r.campaignExternalId, pattern: r.pattern, storeId: r.storeId, priority: r.priority }));

  return (
    <>
      <div
        className={cn(
          "mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3",
          unassignedSpend > 0 ? "border-warn/30 bg-warn-soft text-warn" : "border-line bg-surface text-muted",
        )}
      >
        <span className="text-sm font-medium">Unassigned ad spend, last 30 days</span>
        <span className="text-2xl font-semibold tabular-nums">{fmt(unassignedSpend, "money", cur)}</span>
        <span className="text-xs">
          {unassignedSpend > 0
            ? `${unassigned.rows[0]?.campaigns ?? 0} campaign(s) are not counted in any store’s profit. Set a default store or add a rule below.`
            : "All spend is mapped to a store."}
        </span>
      </div>

      <Section title="Ad accounts" description="Each account’s default store receives its spend unless a campaign rule says otherwise. Disabled accounts are not synced and count as Unassigned.">
        {accounts.length === 0 ? (
          <Empty>No ad accounts yet. Add the Meta token under Connections, then “Discover ad accounts”.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Ad account</th>
                  <th>Currency</th>
                  <th>Time zone</th>
                  <th>Status</th>
                  <th>Default store</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const mapped = storeRows.find((s) => s.id === a.storeId);
                  const tzMismatch = mapped && mapped.timeZone !== a.timeZone;
                  return (
                    <tr key={a.id} className={cn(!a.enabled && "opacity-60")}>
                      <td>
                        <ActionForm action={setAccountEnabled} inline>
                          <input type="hidden" name="id" value={a.id} />
                          <AutoCheckbox name="enabled" defaultChecked={a.enabled} label={`Enable ${a.name}`} />
                        </ActionForm>
                      </td>
                      <td>
                        <div className="font-medium">{a.name}</div>
                        <div className="font-mono text-xs text-muted">{a.externalId}</div>
                      </td>
                      <td>{a.currency}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {a.timeZone}
                          {tzMismatch && (
                            <span className="pill gap-1 bg-warn-soft text-warn" title={`${mapped.name} uses ${mapped.timeZone}: ad days and store days do not line up exactly.`}>
                              <AlertTriangle size={12} /> differs from store
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs">{a.accountStatus ? (ACCOUNT_STATUS[a.accountStatus] ?? `Code ${a.accountStatus}`) : "—"}</td>
                      <td>
                        <ActionForm action={setAccountStore} inline>
                          <input type="hidden" name="id" value={a.id} />
                          <AutoSelect name="storeId" defaultValue={a.storeId ?? ""} className={cn("h-8 min-w-36", !a.storeId && "border-warn text-warn")} aria-label={`Default store for ${a.name}`}>
                            <option value="">Unassigned</option>
                            {storeRows.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </AutoSelect>
                        </ActionForm>
                      </td>
                      <td className="text-xs">{a.historyLoadedAt ? when(a.historyLoadedAt) : <span className="text-warn">Not loaded</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Campaign rules"
        description={
          <>
            Rules send a campaign’s spend to a store regardless of the account default. Lowest priority number wins; “Name” matches text anywhere in the campaign name (case-insensitive) or a{" "}
            <code className="font-mono">/regex/</code>.
          </>
        }
      >
        <div className="card mb-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="num">Priority</th>
                <th>Ad account</th>
                <th>Match</th>
                <th>Store</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted">
                    No rules. Spend follows each account’s default store.
                  </td>
                </tr>
              )}
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.priority}</td>
                  <td>{r.adAccountId ? (accountById.get(r.adAccountId)?.name ?? `#${r.adAccountId}`) : <span className="text-muted">Any account</span>}</td>
                  <td>
                    {r.campaignExternalId ? (
                      <span>
                        Campaign <strong>{campaignName.get(`${r.adAccountId}:${r.campaignExternalId}`) ?? campaignRows.rows.find((c) => c.external_id === r.campaignExternalId)?.name ?? r.campaignExternalId}</strong>
                      </span>
                    ) : (
                      <span>
                        Name {r.pattern?.startsWith("/") ? "matches" : "contains"} <code className="rounded bg-surface-2 px-1 font-mono">{r.pattern}</code>
                      </span>
                    )}
                  </td>
                  <td>{storeName.get(r.storeId) ?? `#${r.storeId}`}</td>
                  <td className="text-right">
                    <ActionForm action={deleteCampaignRule} inline confirm="Delete this rule? Spend is re-mapped.">
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn btn-sm btn-danger" aria-label="Delete rule">
                        <Trash2 size={13} /> Delete
                      </button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {storeRows.length > 0 && (
          <div className="card p-4">
            <RuleForm
              action={addCampaignRule}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              stores={storeRows.map((s) => ({ id: s.id, name: s.name }))}
              campaigns={campaignRows.rows.map((c) => ({ externalId: c.external_id, name: c.name, adAccountId: c.ad_account_id }))}
            />
          </div>
        )}
      </Section>

      <Section
        title="Campaign preview"
        description="Where each campaign’s spend goes now, and where the current accounts and rules send it. The worker applies changes in the background (meta-remap)."
      >
        {campaignRows.rows.length === 0 ? (
          <Empty>No campaigns synced yet.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Ad account</th>
                  <th>Status</th>
                  <th>Store</th>
                  <th className="num">Spend, 30 days</th>
                </tr>
              </thead>
              <tbody>
                {campaignRows.rows.map((c) => {
                  const acct = accountById.get(c.ad_account_id);
                  const resolved = acct?.enabled ? mapCampaignToStore({ id: c.external_id, name: c.name, adAccountId: c.ad_account_id }, acct.storeId, ruleInput) : null;
                  const pending = resolved !== c.store_id;
                  return (
                    <tr key={c.id}>
                      <td className="max-w-80 truncate" title={c.name}>
                        {c.name}
                      </td>
                      <td className="text-xs text-muted">{acct?.name ?? "—"}</td>
                      <td className="text-xs text-muted">{c.effective_status?.toLowerCase().replace(/_/g, " ") ?? "—"}</td>
                      <td>
                        {c.store_id ? storeName.get(c.store_id) : <span className="pill bg-warn-soft text-warn">Unassigned</span>}
                        {pending && (
                          <span className="ml-2 text-xs text-accent" title="Applies when the worker finishes re-mapping">
                            → {resolved ? storeName.get(resolved) : "Unassigned"} (pending)
                          </span>
                        )}
                      </td>
                      <td className="num">{fmt(Number(c.spend), "money", cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
