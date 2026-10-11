import { getDb, getSettings, sql } from "@ecom/db";
import { saveMoneySettings, syncNow } from "../actions";
import { ActionForm, Submit } from "../ui";
import { Empty, Field, Section } from "../Section";
import { when } from "../format";

export async function MoneyTab() {
  const db = getDb();
  const [settings, rates, lastRun] = await Promise.all([
    getSettings(db),
    // latest ECB rate for USD and every currency a store or ad account uses
    db.execute<{ currency: string; date: string; per_eur: string }>(sql`
      select distinct on (currency) currency, date::text date, per_eur from fx_rates
      where currency in (select 'USD' union select currency from stores union select currency from ad_accounts)
      order by currency, date desc`),
    db.execute<{ status: string; finished_at: Date | null; started_at: Date }>(sql`select status, finished_at, started_at from sync_runs where source = 'fx' or job like 'fx%' order by started_at desc limit 1`),
  ]);
  const taxPct = Number(settings.profit_tax_rate) * 100;
  const usd = rates.rows.find((r) => r.currency === "USD");

  return (
    <>
      <Section title="Display and profit tax" description="Every amount is stored in its own currency and converted to USD and EUR at the ECB rate of its day.">
        <ActionForm action={saveMoneySettings} className="card grid max-w-2xl gap-4 p-4 sm:grid-cols-2">
          <Field label="Default display currency">
            <select name="defaultCurrency" defaultValue={settings.default_currency} className="input w-full">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
          <Field label="Profit tax rate, % (0 = off)">
            <input name="taxPercent" type="number" min={0} max={99.99} step={0.01} defaultValue={Number(taxPct.toFixed(2))} className="input w-full" />
          </Field>
          <p className="text-xs text-muted sm:col-span-2">
            Net profit is always shown before tax. With a rate set, the dashboard adds “Profit tax” and “Profit after tax” (positive profit × rate). Bulgarian corporate tax is 10%.
          </p>
          <div>
            <Submit variant="primary">Save</Submit>
          </div>
        </ActionForm>
      </Section>

      <Section
        title="Exchange rates"
        description="European Central Bank reference rates, loaded every working day around 16:00 CET. Days without a rate (weekends, holidays) use the last published one."
        actions={
          <ActionForm action={syncNow} inline>
            <input type="hidden" name="queue" value="fx-ecb" />
            <Submit className="btn-sm">Refresh rates</Submit>
          </ActionForm>
        }
      >
        {rates.rows.length === 0 ? (
          <Empty>No rates loaded yet.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {usd && (
              <div className="card p-4">
                <div className="text-xs text-muted">EUR → USD</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{Number(usd.per_eur).toFixed(4)}</div>
                <div className="mt-1 text-xs text-muted">ECB, {usd.date}</div>
              </div>
            )}
            <div className="card overflow-x-auto sm:col-span-2">
              <table className="table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th className="num">Per 1 EUR</th>
                    <th>Rate date</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.rows.map((r) => (
                    <tr key={r.currency}>
                      <td className="font-medium">{r.currency}</td>
                      <td className="num">{Number(r.per_eur).toFixed(4)}</td>
                      <td className="tabular text-xs">{r.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {lastRun.rows[0] && (
          <p className="mt-2 text-xs text-muted">
            Last rates job: {lastRun.rows[0].status} · {when(lastRun.rows[0].finished_at ?? lastRun.rows[0].started_at)}
          </p>
        )}
      </Section>
    </>
  );
}
