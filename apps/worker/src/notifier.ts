import { getDb, notify, type Db } from "@ecom/db";

/**
 * Where alerts go. Today: notices inside the dashboard. Email or Telegram can be added
 * later by implementing Notifier and listing it in NOTIFIERS — callers do not change.
 */
export interface Alert {
  kind: "renewal" | "sync_error" | "reconcile" | "info" | "login";
  severity?: "info" | "warning" | "error";
  title: string;
  body?: string;
  link?: string;
  /** Same key = same notice; prevents repeats. */
  dedupeKey?: string;
}

export interface Notifier {
  name: string;
  send(alert: Alert): Promise<void>;
}

export const dashboardNotifier = (db: Db = getDb()): Notifier => ({
  name: "dashboard",
  send: (a) => notify(db, a),
});

const NOTIFIERS: Notifier[] = [dashboardNotifier()];

export async function alert(a: Alert) {
  for (const n of NOTIFIERS) {
    try {
      await n.send(a);
    } catch (e) {
      console.error(`notifier ${n.name} failed`, e);
    }
  }
}
