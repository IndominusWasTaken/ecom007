"use server";
import { redirect } from "next/navigation";
import { verify } from "@node-rs/argon2";
import { decryptSecret, encryptSecret } from "@ecom/core/crypto";
import { verifyTotp } from "@ecom/core/totp";
import { audit, eq, getDb, users } from "@ecom/db";
import { createSession, destroySession, getSession, LOCK_MINUTES, MAX_FAILED, requestIp } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

// a fixed hash so unknown usernames take as long as wrong passwords
const DUMMY = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$J5Yq0YbZbW0Tq7qLqJYbS6r2y8m6wq8h9mS0jX4Tf3E";

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const db = getDb();
  const ip = await requestIp();
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user) {
    await verify(DUMMY, password).catch(() => false);
    await audit(db, { action: "login.fail", entity: "user", entityId: username, ip });
    return { error: "Wrong username or password." };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: `Too many attempts. Try again after ${user.lockedUntil.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` };
  }
  const ok = await verify(user.passwordHash, password).catch(() => false);
  if (!ok) {
    const failed = user.failedAttempts + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await db.update(users).set({ failedAttempts: lock ? 0 : failed, lockedUntil: lock }).where(eq(users.id, user.id));
    await audit(db, { userId: user.id, action: lock ? "login.locked" : "login.fail", entity: "user", entityId: user.id, ip });
    return { error: lock ? `Too many attempts. Locked for ${LOCK_MINUTES} minutes.` : "Wrong username or password." };
  }
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await createSession(user.id, "pending");
  redirect("/login/2fa");
}

export async function totpAction(_: LoginState, form: FormData): Promise<LoginState> {
  const s = await getSession();
  if (!s) redirect("/login");
  const db = getDb();
  const ip = await requestIp();
  const code = String(form.get("code") ?? "");
  const user = s.user;
  if (user.lockedUntil && user.lockedUntil > new Date()) return { error: "Account locked. Try again later." };

  let secret: string;
  if (user.totpEnabled && user.totpSecretEnc) secret = decryptSecret(user.totpSecretEnc);
  else {
    // enrolment: the secret shown on the page travels in the form, encrypted
    const enc = String(form.get("enrol") ?? "");
    if (!enc) return { error: "Enrolment expired. Reload the page." };
    secret = decryptSecret(enc);
  }
  const step = verifyTotp(secret, code, Date.now(), user.totpLastStep);
  if (step === null) {
    const failed = user.failedAttempts + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await db.update(users).set({ failedAttempts: lock ? 0 : failed, lockedUntil: lock }).where(eq(users.id, user.id));
    await audit(db, { userId: user.id, action: "login.totp_fail", entity: "user", entityId: user.id, ip });
    if (lock) {
      await destroySession();
      return { error: `Too many attempts. Locked for ${LOCK_MINUTES} minutes.` };
    }
    return { error: "That code is not valid. Check your authenticator app's time." };
  }
  await db
    .update(users)
    .set({ totpLastStep: step, failedAttempts: 0, ...(user.totpEnabled ? {} : { totpEnabled: true, totpSecretEnc: encryptSecret(secret) }) })
    .where(eq(users.id, user.id));
  await destroySession();
  await createSession(user.id, "full");
  await audit(db, { userId: user.id, action: user.totpEnabled ? "login.ok" : "login.totp_enrolled", entity: "user", entityId: user.id, ip });
  redirect("/");
}
