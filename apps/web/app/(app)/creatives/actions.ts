"use server";
import { revalidatePath } from "next/cache";
import { audit, getDb, sql } from "@ecom/db";
import { requireUser } from "@/lib/auth";

const TAG_KINDS = ["product", "angle", "creator", "winner", "other"];
const FILTER_KEYS = ["scope", "status", "format", "tag", "sort", "q"];

/** Tag a creative group; the tag (kind + name) is created on first use. */
export async function addCreativeTag(groupKey: string, name: string, kind: string) {
  const user = await requireUser();
  const clean = name.trim().slice(0, 64);
  const k = TAG_KINDS.includes(kind) ? kind : "other";
  if (!clean || !groupKey) return;
  const db = getDb();
  const res = await db.execute<{ id: number }>(
    sql`insert into tags (name, kind) values (${clean}, ${k})
        on conflict (kind, name) do update set name = excluded.name returning id`,
  );
  const tagId = res.rows[0].id;
  await db.execute(sql`insert into creative_tags (group_key, tag_id) values (${groupKey}, ${tagId}) on conflict do nothing`);
  await audit(db, { userId: user.id, action: "creative_tag.add", entity: "creative_group", entityId: groupKey, newValue: { tagId, name: clean, kind: k } });
  revalidatePath("/creatives", "layout");
}

export async function removeCreativeTag(groupKey: string, tagId: number) {
  const user = await requireUser();
  const db = getDb();
  await db.execute(sql`delete from creative_tags where group_key = ${groupKey} and tag_id = ${tagId}`);
  await audit(db, { userId: user.id, action: "creative_tag.remove", entity: "creative_group", entityId: groupKey, oldValue: { tagId } });
  revalidatePath("/creatives", "layout");
}

/** Notes are stored on every creative in the group so they survive re-grouping of one ad. */
export async function saveCreativeNotes(groupKey: string, notes: string) {
  const user = await requireUser();
  const db = getDb();
  const text = notes.trim().slice(0, 10_000) || null;
  const old = await db.execute<{ notes: string | null }>(sql`select notes from creatives where group_key = ${groupKey} order by id limit 1`);
  await db.execute(sql`update creatives set notes = ${text} where group_key = ${groupKey}`);
  await audit(db, { userId: user.id, action: "creative.notes", entity: "creative_group", entityId: groupKey, oldValue: old.rows[0]?.notes ?? null, newValue: text });
  revalidatePath("/creatives", "layout");
}

/** Save the current filter (only filter keys, not the date range) as a named tab. */
export async function saveCreativeView(name: string, query: string) {
  const user = await requireUser();
  const clean = name.trim().slice(0, 64);
  if (!clean) return;
  const src = new URLSearchParams(query);
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = src.get(k);
    if (v) q.set(k, v);
  }
  const db = getDb();
  const res = await db.execute<{ id: number }>(
    sql`insert into saved_views (page, name, query, created_by, sort_order)
        values ('creatives', ${clean}, ${q.toString()}, ${user.id}, (select coalesce(max(sort_order), 0) + 1 from saved_views where page = 'creatives'))
        returning id`,
  );
  await audit(db, { userId: user.id, action: "saved_view.create", entity: "saved_view", entityId: res.rows[0].id, newValue: { page: "creatives", name: clean, query: q.toString() } });
  revalidatePath("/creatives");
}

export async function deleteCreativeView(id: number) {
  const user = await requireUser();
  const db = getDb();
  await db.execute(sql`delete from saved_views where id = ${id} and page = 'creatives'`);
  await audit(db, { userId: user.id, action: "saved_view.delete", entity: "saved_view", entityId: id });
  revalidatePath("/creatives");
}
