"use server";
import { revalidatePath } from "next/cache";
import { audit, chartNotes, dashboardLayouts, eq, getDb, notices, sql } from "@ecom/db";
import { requireUser } from "@/lib/auth";

export async function dismissNotice(id: number) {
  await requireUser();
  await getDb().update(notices).set({ dismissedAt: new Date() }).where(eq(notices.id, id));
}

export async function dismissAllNotices() {
  await requireUser();
  await getDb().execute(sql`update notices set dismissed_at = now() where dismissed_at is null`);
}

export async function saveLayout(layout: { pins: string[]; order: Record<string, string[]>; hidden?: string[] }) {
  const user = await requireUser();
  await getDb()
    .insert(dashboardLayouts)
    .values({ userId: user.id, layout })
    .onConflictDoUpdate({ target: dashboardLayouts.userId, set: { layout, updatedAt: new Date() } });
}

export async function addChartNote(form: FormData) {
  const user = await requireUser();
  const date = String(form.get("date") ?? "");
  const text = String(form.get("text") ?? "").trim().slice(0, 255);
  const storeId = form.get("storeId") ? Number(form.get("storeId")) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) return;
  const [row] = await getDb().insert(chartNotes).values({ date, text, storeId, createdBy: user.id }).returning();
  await audit(getDb(), { userId: user.id, action: "chart_note.create", entity: "chart_note", entityId: row.id, newValue: row });
  revalidatePath("/", "layout");
}

export async function deleteChartNote(id: number) {
  const user = await requireUser();
  await getDb().delete(chartNotes).where(eq(chartNotes.id, id));
  await audit(getDb(), { userId: user.id, action: "chart_note.delete", entity: "chart_note", entityId: id });
  revalidatePath("/", "layout");
}
