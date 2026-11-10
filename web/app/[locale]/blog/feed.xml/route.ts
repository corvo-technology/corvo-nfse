import { buildFeed } from "@/lib/blog/seo";

/** RSS feed of the blog, at /pt/blog/feed.xml (paths with a dot skip the proxy, so it is served as is). */
export function GET() {
  return new Response(buildFeed(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

/** Only the Portuguese blog exists. */
export function generateStaticParams() {
  return [{ locale: "pt" }];
}
