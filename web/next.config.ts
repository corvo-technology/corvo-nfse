import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** Private screens must never be indexed, even when linked from elsewhere. */
const noIndex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  output: "standalone",
  // AVIF first, WebP as fallback; the PNG source is only served to browsers without either.
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    return [
      { source: "/app/:path*", headers: noIndex },
      { source: "/login", headers: noIndex },
      { source: "/mcp/:path*", headers: noIndex },
    ];
  },
};

const uploadSourcemaps = Boolean(process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID);

// Source maps go to the PostHog app host, not the ingestion host used by the browser SDK.
export default uploadSourcemaps
  ? withPostHogConfig(withNextIntl(nextConfig), {
      personalApiKey: process.env.POSTHOG_API_KEY!,
      projectId: process.env.POSTHOG_PROJECT_ID,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(".i.posthog.com", ".posthog.com"),
      sourcemaps: { enabled: true, deleteAfterUpload: true },
    })
  : withNextIntl(nextConfig);
