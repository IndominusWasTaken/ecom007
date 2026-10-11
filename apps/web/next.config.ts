import type { NextConfig } from "next";
import "@ecom/db/env";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@ecom/core", "@ecom/db", "@ecom/metrics", "@ecom/connectors"],
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
