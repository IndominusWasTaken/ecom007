/** Option lists shared by the expense forms, actions and pages. */

export const CATEGORIES = [
  { value: "tools", label: "Tools" },
  { value: "apps", label: "Shopify apps" },
  { value: "domains", label: "Domains" },
  { value: "shopify_plan", label: "Shopify plan" },
  { value: "hosting", label: "Hosting" },
  { value: "contractors", label: "Contractors" },
  { value: "advertising", label: "Advertising" },
  { value: "other", label: "Other" },
] as const;

export const CYCLES = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "every_n_months", label: "Every N months" },
  { value: "one_off", label: "One-off" },
] as const;

export const STATUSES = [
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

export function cycleLabel(cycle: string, n?: number | null) {
  if (cycle === "every_n_months") return `Every ${n ?? "?"} months`;
  return CYCLES.find((c) => c.value === cycle)?.label ?? cycle;
}
