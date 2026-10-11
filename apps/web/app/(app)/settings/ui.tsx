"use client";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ActionResult } from "./actions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

/**
 * A form bound to a settings server action that shows the action's result message under it.
 * Children are plain inputs (rendered on the server is fine).
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  reset = false,
  inline = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  reset?: boolean;
  inline?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok && reset) ref.current?.reset();
    return r;
  }, null);
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn(inline ? "inline-flex flex-wrap items-center gap-2" : undefined, className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state && (
        <p role="status" className={cn("text-xs", inline ? "basis-full" : "mt-2", state.ok ? "text-pos" : "text-neg")}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, className, variant }: { children: React.ReactNode; className?: string; variant?: "primary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn", variant === "primary" && "btn-primary", variant === "danger" && "btn-danger", className)}>
      {pending && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/** A select that submits its form on change. */
export function AutoSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("input", props.className)} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** A switch-like checkbox that submits its form on change. */
export function AutoCheckbox({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 accent-[var(--accent)]" onChange={(e) => e.currentTarget.form?.requestSubmit()} aria-label={label} />
      <span className="sr-only">{label}</span>
    </label>
  );
}

/** Rule editor: match by name ("contains" or /regex/) or pick one campaign. */
export function RuleForm({
  action,
  accounts,
  stores,
  campaigns,
}: {
  action: Action;
  accounts: { id: number; name: string }[];
  stores: { id: number; name: string }[];
  campaigns: { externalId: string; name: string; adAccountId: number }[];
}) {
  const [mode, setMode] = useState<"pattern" | "campaign">("pattern");
  const [account, setAccount] = useState("");
  const list = account ? campaigns.filter((c) => String(c.adAccountId) === account) : campaigns;
  return (
    <ActionForm action={action} reset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1.4fr_1fr_6rem_auto] lg:items-end">
      <div>
        <label className="label" htmlFor="rule-account">
          Ad account
        </label>
        <select id="rule-account" name="adAccountId" className="input w-full" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className="label">Match</span>
        <div className="flex h-9 overflow-hidden rounded-lg border border-line text-xs font-medium">
          {(["pattern", "campaign"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("px-3", mode === m ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:bg-surface-2")}
            >
              {m === "pattern" ? "Name" : "Campaign"}
            </button>
          ))}
        </div>
        <input type="hidden" name="mode" value={mode} />
      </div>
      <div>
        {mode === "pattern" ? (
          <>
            <label className="label" htmlFor="rule-pattern">
              Name contains, or /regex/
            </label>
            <input id="rule-pattern" name="pattern" className="input w-full" placeholder="BG  or  /\bBG\b/i" required />
          </>
        ) : (
          <>
            <label className="label" htmlFor="rule-campaign">
              Campaign
            </label>
            <select id="rule-campaign" name="campaign" className="input w-full" required>
              {list.map((c) => (
                <option key={`${c.adAccountId}:${c.externalId}`} value={c.externalId}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div>
        <label className="label" htmlFor="rule-store">
          Store
        </label>
        <select id="rule-store" name="storeId" className="input w-full" required>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="rule-priority">
          Priority
        </label>
        <input id="rule-priority" name="priority" type="number" min={0} defaultValue={100} className="input w-full" title="Lower numbers are checked first" />
      </div>
      <Submit variant="primary">Add rule</Submit>
    </ActionForm>
  );
}
