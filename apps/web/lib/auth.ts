import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomToken, sha256 } from "@ecom/core/crypto";
import { authSessions, eq, getDb, sql, users } from "@ecom/db";

export const SESSION_COOKIE = "pd_session";
const IDLE_DAYS = 14;
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;

export type User = typeof users.$inferSelect;

async function clientInfo() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  return { ip, ua: h.get("user-agent") };
}

export async function createSession(userId: number, stage: "pending" | "full") {
  const token = randomToken(32);
  const { ip, ua } = await clientInfo();
  await getDb().insert(authSessions).values({ id: sha256(token), userId, stage, ip, userAgent: ua });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    sameSite: "lax",
    path: "/",
    maxAge: stage === "pending" ? 10 * 60 : IDLE_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(authSessions).where(eq(authSessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Session lookup with a 14-day idle expiry (sliding). */
export async function getSession(): Promise<{ user: User; stage: string; id: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const db = getDb();
  const res = await db.execute<{ stage: string; user_id: number; last_seen_at: Date; created_at: Date }>(
    sql`select stage, user_id, last_seen_at, created_at from auth_sessions where id = ${id}`,
  );
  const s = res.rows[0];
  if (!s) return null;
  const idleLimit = s.stage === "pending" ? 10 * 60_000 : IDLE_DAYS * 86_400_000;
  if (Date.now() - new Date(s.last_seen_at).getTime() > idleLimit) {
    await db.delete(authSessions).where(eq(authSessions.id, id));
    return null;
  }
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
    await db.update(authSessions).set({ lastSeenAt: new Date() }).where(eq(authSessions.id, id));
  }
  const [user] = await db.select().from(users).where(eq(users.id, s.user_id));
  if (!user) return null;
  return { user, stage: s.stage, id };
}

/** For every page and action behind the login. */
export async function requireUser(): Promise<User> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.stage !== "full") redirect("/login/2fa");
  return s.user;
}

export async function requestIp() {
  return (await clientInfo()).ip;
}
