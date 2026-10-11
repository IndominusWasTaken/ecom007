import { requireUser } from "@/lib/auth";
import { parseView, withParams, type SearchParams } from "@/lib/params";
import { PageHeader } from "@/components/PageHeader";
import { CurrencyToggle, PageTabs } from "@/components/PageTabs";
import { CogsTab } from "./cogs";
import { CostLog, FeesTab, HandlingTab, ShippingTab } from "./rules";

export const metadata = { title: "Costs" };

const TABS = [
  { key: "cogs", label: "Product costs (COGS)" },
  { key: "shipping", label: "Shipping" },
  { key: "handling", label: "Handling" },
  { key: "fees", label: "Payment fees" },
  { key: "log", label: "Edit log" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const view = parseView(sp);
  const tab: Tab = TABS.some((t) => t.key === one(sp.tab)) ? (one(sp.tab) as Tab) : "cogs";
  const keep = { tab, cur: one(sp.cur) || null };

  return (
    <>
      <PageHeader
        title="Costs"
        subtitle="Unit costs and per-order cost rules. Every change is a new dated row, so past profit is never rewritten."
        view={view}
        showControls={false}
        actions={<CurrencyToggle current={view.currency} hrefs={{ USD: withParams("/costs", sp, { cur: "USD" }), EUR: withParams("/costs", sp, { cur: "EUR" }) }} />}
      />
      <PageTabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: withParams("/costs", { cur: keep.cur ?? undefined }, { tab: t.key }) }))} />
      {tab === "cogs" && <CogsTab currency={view.currency} q={one(sp.q)} store={one(sp.store)} missing={one(sp.missing) === "1"} sp={sp} />}
      {tab === "shipping" && <ShippingTab />}
      {tab === "handling" && <HandlingTab />}
      {tab === "fees" && <FeesTab />}
      {tab === "log" && <CostLog />}
    </>
  );
}
