import { getDb, sql } from "@ecom/db";
import { getSession, type User } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { changePassword, resetOwnTwoFactor, signOutOtherSessions } from "../actions";
import { ActionForm, Submit } from "../ui";
import { Field, Section } from "../Section";
import { ago, when } from "../format";

/** Shorten a user agent to "Browser on OS" for the sessions list. */
function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export async function UsersTab({ user }: { user: User }) {
  const db = getDb();
  const session = await getSession();
  const [userRows, sessions, logins] = await Promise.all([
    db.execute<{ id: number; username: string; display_name: string | null; totp_enabled: boolean; failed_attempts: number; locked_until: Date | null; last_login: Date | null }>(sql`
      select u.id, u.username, u.display_name, u.totp_enabled, u.failed_attempts, u.locked_until,
        (select max(at) from audit_log a where a.user_id = u.id and a.action in ('login.ok', 'login.totp_enrolled')) last_login
      from users u order by u.id`),
    db.execute<{ id: string; created_at: Date; last_seen_at: Date; ip: string | null; user_agent: string | null }>(sql`
      select id, created_at, last_seen_at, ip, user_agent from auth_sessions
      where user_id = ${user.id} and stage = 'full' order by last_seen_at desc`),
    db.execute<{ id: number; action: string; at: Date; ip: string | null; username: string | null; entity_id: string | null }>(sql`
      select a.id, a.action, a.at, a.ip, u.username, a.entity_id from audit_log a left join users u on u.id = a.user_id
      where a.action like 'login.%' order by a.at desc limit 50`),
  ]);

  return (
    <>
      <Section
        title="Users"
        description={
          <>
            There are at most two users. They are created only on the server: <code className="rounded bg-surface-2 px-1 font-mono">pnpm user:create &lt;name&gt;</code>. Locked accounts unlock by themselves
            after 15 minutes, or with <code className="rounded bg-surface-2 px-1 font-mono">pnpm --filter @ecom/worker cli unlock &lt;name&gt;</code>.
          </>
        }
      >
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Display name</th>
                <th>2FA</th>
                <th>Last login</th>
                <th className="num">Failed attempts</th>
                <th>Locked until</th>
              </tr>
            </thead>
            <tbody>
              {userRows.rows.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">
                    {u.username}
                    {u.id === user.id && <span className="pill ml-2 bg-accent-soft text-accent">you</span>}
                  </td>
                  <td>{u.display_name ?? "—"}</td>
                  <td>
                    <span className={cn("pill", u.totp_enabled ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn")}>{u.totp_enabled ? "Enabled" : "Not set up"}</span>
                  </td>
                  <td className="text-xs" title={when(u.last_login)}>
                    {ago(u.last_login)}
                  </td>
                  <td className="num">{u.failed_attempts}</td>
                  <td className={cn("text-xs", u.locked_until && new Date(u.locked_until) > new Date() && "text-neg")}>
                    {u.locked_until && new Date(u.locked_until) > new Date() ? when(u.locked_until) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Change your password" description="At least 12 characters. Your other sessions are signed out.">
          <ActionForm action={changePassword} reset className="card grid gap-3 p-4">
            <input type="text" name="username" autoComplete="username" defaultValue={user.username} hidden readOnly />
            <Field label="Current password">
              <input name="current" type="password" className="input w-full" autoComplete="current-password" required />
            </Field>
            <Field label="New password">
              <input name="next" type="password" className="input w-full" autoComplete="new-password" minLength={12} required />
            </Field>
            <Field label="Repeat new password">
              <input name="repeat" type="password" className="input w-full" autoComplete="new-password" minLength={12} required />
            </Field>
            <div>
              <Submit variant="primary">Change password</Submit>
            </div>
          </ActionForm>
        </Section>

        <Section title="Reset two-factor" description="Use this when you move to a new phone. You are signed out everywhere and set up the authenticator again at the next login.">
          <ActionForm action={resetOwnTwoFactor} className="card grid gap-3 p-4" confirm="Reset two-factor and sign out now?">
            <Field label="Current password">
              <input name="current" type="password" className="input w-full" autoComplete="current-password" required />
            </Field>
            <div>
              <Submit variant="danger">Reset 2FA and sign out</Submit>
            </div>
          </ActionForm>
        </Section>
      </div>

      <Section
        title="Your active sessions"
        description="Sessions end after 14 days without use."
        actions={
          sessions.rows.length > 1 && (
            <ActionForm action={signOutOtherSessions} inline confirm="Sign out every other session?">
              <Submit className="btn-sm">Sign out other sessions</Submit>
            </ActionForm>
          )
        }
      >
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Device</th>
                <th>IP</th>
                <th>Signed in</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {sessions.rows.map((s) => (
                <tr key={s.id}>
                  <td title={s.user_agent ?? undefined}>
                    {device(s.user_agent)}
                    {s.id === session?.id && <span className="pill ml-2 bg-accent-soft text-accent">this session</span>}
                  </td>
                  <td className="font-mono text-xs">{s.ip ?? "—"}</td>
                  <td className="text-xs">{when(s.created_at)}</td>
                  <td className="text-xs" title={when(s.last_seen_at)}>
                    {ago(s.last_seen_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Login activity" description="The last 50 sign-in events for both users.">
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>User</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logins.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted">
                    No login events yet.
                  </td>
                </tr>
              )}
              {logins.rows.map((l) => (
                <tr key={l.id}>
                  <td className="text-xs">{when(l.at)}</td>
                  <td>
                    <span className={cn("pill", l.action === "login.ok" || l.action === "login.totp_enrolled" ? "bg-pos-soft text-pos" : "bg-neg-soft text-neg")}>{l.action.replace("login.", "").replace("_", " ")}</span>
                  </td>
                  <td>{l.username ?? <span className="text-muted">{l.entity_id ?? "unknown"}</span>}</td>
                  <td className="font-mono text-xs">{l.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
