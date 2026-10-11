import type { Connector } from "../types";

/** Google Ads: not built yet. Implement the three operations here; nothing else changes. */
export const googleAdsConnector: Connector<unknown, unknown> = {
  platform: "google",
  label: "Google Ads",
  available: false,
  loadHistory: async () => {
    throw new Error("Google Ads connector is not implemented yet");
  },
  syncSince: async () => {
    throw new Error("Google Ads connector is not implemented yet");
  },
  checkHealth: async () => ({ ok: false, message: "Coming soon" }),
};
