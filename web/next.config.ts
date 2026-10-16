import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** Private screens must never be indexed, even when linked from elsewhere. */
const noIndex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      { source: "/app/:path*", headers: noIndex },
      { source: "/login", headers: noIndex },
      { source: "/mcp/:path*", headers: noIndex },
    ];
  },
};

export default withNextIntl(nextConfig);
