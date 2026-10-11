"use client";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { addCreativeTag, removeCreativeTag } from "./actions";

interface Tag {
  id: number;
  name: string;
  kind: string;
}

export const TAG_KINDS = ["product", "angle", "creator", "winner", "other"] as const;

export const TAG_STYLE: Record<string, string> = {
  product: "bg-accent-soft text-accent",
  angle: "bg-warn-soft text-warn",
  creator: "border border-line bg-surface text-ink",
  winner: "bg-pos-soft text-pos",
  other: "bg-surface-2 text-muted",
};

export function TagPill({ tag, onRemove, className }: { tag: Tag; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("pill gap-1", TAG_STYLE[tag.kind] ?? TAG_STYLE.other, className)} title={`${tag.kind}: ${tag.name}`}>
      <span className="opacity-60">{tag.kind === "other" ? "" : `${tag.kind}:`}</span>
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="-mr-0.5 rounded-full opacity-60 hover:opacity-100" aria-label={`Remove tag ${tag.name}`}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

/** Tags on one creative group, with inline add (pick an existing tag or type a new one) and remove. */
export function TagEditor({ groupKey, tags, allTags }: { groupKey: string; tags: Tag[]; allTags: Tag[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("product");
  const [pending, start] = useTransition();
  const listId = `tags-${groupKey.replace(/[^a-z0-9]/gi, "-")}`;

  const add = () => {
    const n = name.trim();
    if (!n) return;
    // Picking an existing name keeps its kind.
    const existing = allTags.find((t) => t.name.toLowerCase() === n.toLowerCase());
    start(async () => {
      await addCreativeTag(groupKey, existing?.name ?? n, existing?.kind ?? kind);
      setName("");
      setOpen(false);
    });
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", pending && "opacity-60")}>
      {tags.map((t) => (
        <TagPill key={t.id} tag={t} onRemove={() => start(() => removeCreativeTag(groupKey, t.id))} />
      ))}
      {open ? (
        <form
          className="flex w-full flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            autoFocus
            list={listId}
            className="input h-7 min-w-0 flex-1 px-2 text-xs"
            placeholder="Tag name"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            aria-label="Tag name"
          />
          <datalist id={listId}>
            {allTags.filter((t) => !tags.some((x) => x.id === t.id)).map((t) => (
              <option key={t.id} value={t.name}>
                {t.kind}
              </option>
            ))}
          </datalist>
          <select className="input h-7 px-2 text-xs" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tag kind">
            {TAG_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" disabled={pending || !name.trim()}>
            Add
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} aria-label="Cancel">
            <X size={12} />
          </button>
        </form>
      ) : (
        <button className="pill gap-0.5 border border-dashed border-line-strong text-muted hover:text-ink" onClick={() => setOpen(true)}>
          <Plus size={11} /> Tag
        </button>
      )}
    </div>
  );
}
