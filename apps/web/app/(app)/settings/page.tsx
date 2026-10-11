import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { parseView, type SearchParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { StoresTab } from "./tabs/StoresTab";
import { ConnectionsTab } from "./tabs/ConnectionsTab";
import { MappingTab } from "./tabs/MappingTab";
import { SyncTab } from "./tabs/SyncTab";
import { UsersTab } from "./tabs/UsersTab";
import { MoneyTab } from "./tabs/MoneyTab";
import { BackupsTab } from "./tabs/BackupsTab";
import { NotesTab } from "./tabs/NotesTab";

export const metadata = { title: "Settings" };

const TABS = [
  { key: "stores", label: "Stores & regions" },
  { key: "connections", label: "Connections" },
  { key: "mapping", label: "Ad account mapping" },
  { key: "sync", label: "Sync status" },
  { key: "users", label: "Users & security" },
  { key: "money", label: "Currencies & tax" },
  { key: "backups", label: "Backups" },
  { key: "notes", label: "Chart notes" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const tab: TabKey = TABS.some((t) => t.key === one("tab")) ? (one("tab") as TabKey) : "stores";

  return (
    <>
      <PageHeader title="Settings" view={view} showControls={false} />
      <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === t.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "stores" && <StoresTab />}
      {tab === "connections" && <ConnectionsTab />}
      {tab === "mapping" && <MappingTab />}
      {tab === "sync" && <SyncTab status={one("status") ?? "all"} />}
      {tab === "users" && <UsersTab user={user} />}
      {tab === "money" && <MoneyTab />}
      {tab === "backups" && <BackupsTab />}
      {tab === "notes" && <NotesTab />}
    </>
  );
}
