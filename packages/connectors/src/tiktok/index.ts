import type { Connector } from "../types";

/** TikTok Ads: not built yet. Implement the three operations here; nothing else changes. */
export const tiktokAdsConnector: Connector<unknown, unknown> = {
  platform: "tiktok",
  label: "TikTok Ads",
  available: false,
  loadHistory: async () => {
    throw new Error("TikTok connector is not implemented yet");
  },
  syncSince: async () => {
    throw new Error("TikTok connector is not implemented yet");
  },
  checkHealth: async () => ({ ok: false, message: "Coming soon" }),
};
