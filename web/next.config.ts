import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_META_PIXEL_ID) {
  console.warn(
    "NEXT_PUBLIC_META_PIXEL_ID is empty: Meta Pixel will be disabled. Set it as a build variable before building (Docker: --build-arg NEXT_PUBLIC_META_PIXEL_ID=... or compose build.args); runtime environment variables cannot update the browser bundle.",
  );
}

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** Private screens must never be indexed, even when linked from elsewhere. */
const noIndex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

/** Static marketing pages: browsers revalidate, the CDN keeps them for an hour. */
const publicCache = [{ key: "Cache-Control", value: "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" }];

const staticAssetCache = [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }];

const nextConfig: NextConfig = {
  output: "standalone",
  // AVIF first, WebP as fallback; the PNG source is only served to browsers without either.
  // Optimized copies are kept for 30 days (the default is 4 hours); the source images rarely change.
  images: { formats: ["image/avif", "image/webp"], minimumCacheTTL: 60 * 60 * 24 * 30 },
  // Two root layouts ([locale] and (dashboard)) need a global 404 page.
  experimental: { globalNotFound: true },
  // The proxy collapses trailing slashes onto the final URL (for example /docs/ → /pt/docs).
  // Next's own 308 to the slash-less path would run first and add a hop.
  skipTrailingSlashRedirect: true,
  async redirects() {
    // /api-docs is outside the proxy matcher (it starts with "api"), so the redirect lives here.
    // Both forms in one hop: with skipTrailingSlashRedirect, /api-docs/ is not normalized first.
    return [
      { source: "/api-docs", destination: "/pt/api-docs", statusCode: 301 },
      { source: "/api-docs/", destination: "/pt/api-docs", statusCode: 301 },
    ];
  },
  async headers() {
    return [
      // Images and logos in /public: the browser keeps them for 30 days instead of 4 hours.
      { source: "/:dir(dash|integrations|logos|brand)/:file*", headers: staticAssetCache },
      { source: "/app/:path*", headers: noIndex },
      { source: "/login", headers: noIndex },
      { source: "/mcp/:path*", headers: noIndex },
      // Marketing pages and docs are static: let the CDN cache them.
      { source: "/:locale(en|pt)", headers: publicCache },
      { source: "/:locale(en|pt)/:path*", headers: publicCache },
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
