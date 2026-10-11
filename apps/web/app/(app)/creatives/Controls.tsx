"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { BookmarkPlus, Check, Loader2, Search, X } from "lucide-react";
import { deleteCreativeView, saveCreativeNotes, saveCreativeView } from "./actions";

/** Tag filter, sort, name search and "save as tab" for the creative library. */
export function CreativeToolbar({
  tags,
  sorts,
  sort,
  tag,
  q,
  canSave,
}: {
  tags: { id: number; name: string; kind: string }[];
  sorts: { id: string; label: string }[];
  sort: string;
  tag: string;
  q: string;
  canSave: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  const set = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
    start(() => router.push(`${path}?${u}`, { scroll: false }));
  };
  const save = () => {
    const name = window.prompt("Name this tab");
    if (name?.trim()) start(() => saveCreativeView(name, sp.toString()));
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        className="relative w-full sm:w-60"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() || null });
        }}
      >
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
        <input className="input w-full" style={{ paddingLeft: 32 }} placeholder="Search name or copy…" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => search.trim() !== q && set({ q: search.trim() || null })} aria-label="Search creatives" />
      </form>
      <select className="input max-w-48" value={tag} onChange={(e) => set({ tag: e.target.value || null })} aria-label="Filter by tag">
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.kind}: {t.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        Sort
        <select className="input" value={sort} onChange={(e) => set({ sort: e.target.value === "spend" ? null : e.target.value })} aria-label="Sort by">
          {sorts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {pending && <Loader2 size={16} className="animate-spin text-muted" />}
      {canSave && (
        <button className="btn sm:ml-auto" onClick={save} title="Save the current filters as a tab (date range is not saved)">
          <BookmarkPlus size={15} /> Save as tab
        </button>
      )}
    </div>
  );
}

export function DeleteViewButton({ id, name }: { id: number; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="rounded-full p-0.5 text-muted opacity-60 hover:bg-neg-soft hover:text-neg hover:opacity-100"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        if (window.confirm(`Delete the tab "${name}"?`)) start(() => deleteCreativeView(id));
      }}
      aria-label={`Delete tab ${name}`}
    >
      <X size={12} />
    </button>
  );
}

export function NotesEditor({ groupKey, notes }: { groupKey: string; notes: string }) {
  const [value, setValue] = useState(notes);
  const [saved, setSaved] = useState(notes);
  const [pending, start] = useTransition();
  const dirty = value !== saved;
  return (
    <div>
      <textarea
        className="input w-full resize-y py-2 leading-relaxed"
        style={{ height: 140 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What worked, what to test next, hooks to reuse…"
        aria-label="Notes"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          className="btn btn-sm btn-primary"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              await saveCreativeNotes(groupKey, value);
              setSaved(value);
            })
          }
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : null} Save notes
        </button>
        {!dirty && saved && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Check size={12} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
