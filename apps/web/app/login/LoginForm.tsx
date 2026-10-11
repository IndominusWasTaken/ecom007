"use client";
import { useActionState } from "react";
import { loginAction, totpAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <label className="label" htmlFor="username">
          Username
        </label>
        <input id="username" name="username" className="input w-full" autoComplete="username" required autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" className="input w-full" autoComplete="current-password" required />
      </div>
      {state.error && <p className="text-sm text-neg">{state.error}</p>}
      <button className="btn btn-primary mt-1 w-full" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

export function TotpForm({ enrol }: { enrol?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(totpAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {enrol && <input type="hidden" name="enrol" value={enrol} />}
      <div>
        <label className="label" htmlFor="code">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          className="input w-full text-center text-lg tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
        />
      </div>
      {state.error && <p className="text-sm text-neg">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
