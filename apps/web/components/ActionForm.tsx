"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

/** What a form server action returns: a short message, per-line errors, or a value to show once. */
export type ActionResult = { ok: boolean; message?: string; errors?: string[]; reveal?: string } | null;
export type FormAction = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/** A <form> bound to a server action that shows the action's result underneath. */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  /** Ask before submitting (deletes, cancellations). */
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <ResultNote state={state} />
    </form>
  );
}

export function ResultNote({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <div className="mt-2 basis-full text-xs" aria-live="polite">
      {state.message && <p className={state.ok ? "text-pos" : "text-neg"}>{state.message}</p>}
      {state.errors && state.errors.length > 0 && (
        <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-4 text-neg">
          {state.errors.slice(0, 200).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
          {state.errors.length > 200 && <li>… and {state.errors.length - 200} more</li>}
        </ul>
      )}
      {state.reveal && <Reveal value={state.reveal} />}
    </div>
  );
}

function Reveal({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function SubmitButton({ children, className, variant = "primary" }: { children: React.ReactNode; className?: string; variant?: "primary" | "danger" | "plain" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn", variant === "primary" && "btn-primary", variant === "danger" && "btn-danger", className)}>
      {pending ? "Saving…" : children}
    </button>
  );
}
