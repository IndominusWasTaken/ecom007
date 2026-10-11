import { requireUser } from "@/lib/auth";
import { parseView, withParams, type SearchParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { CurrencyToggle, PageTabs } from "@/components/PageTabs";
import { SubscriptionsTab } from "./subscriptions";
import { CalendarTab } from "./calendar";
import { FeedTab, OneOffTab, RenewalsTab } from "./other";

export const metadata = { title: "Expenses" };

const TABS = [
  { key: "subscriptions", label: "Subscriptions" },
  { key: "calendar", label: "Calendar" },
  { key: "renewals", label: "Renewal log" },
  { key: "oneoff", label: "One-off expenses" },
  { key: "feed", label: "Calendar feed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const tab: Tab = TABS.some((t) => t.key === one(sp.tab)) ? (one(sp.tab) as Tab) : "subscriptions";
  const cur = one(sp.cur) || undefined;

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Subscriptions and one-off costs. Each charge counts in full on its date, split across the stores in its scope."
        view={view}
        showControls={false}
        actions={<CurrencyToggle current={view.currency} hrefs={{ USD: withParams("/expenses", sp, { cur: "USD" }), EUR: withParams("/expenses", sp, { cur: "EUR" }) }} />}
      />
      <PageTabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: withParams("/expenses", { cur }, { tab: t.key }) }))} />
      {tab === "subscriptions" && <SubscriptionsTab currency={view.currency} editId={Number(one(sp.edit)) || null} showCancelled={one(sp.cancelled) === "1"} sp={sp} />}
      {tab === "calendar" && <CalendarTab currency={view.currency} month={one(sp.month)} sp={sp} />}
      {tab === "renewals" && <RenewalsTab currency={view.currency} />}
      {tab === "oneoff" && <OneOffTab currency={view.currency} />}
      {tab === "feed" && <FeedTab />}
    </>
  );
}
