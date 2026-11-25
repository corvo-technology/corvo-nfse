import { plain } from "./inline";
import { BLOG_LOCALE, POSTS, readingMinutes, wordCount } from "./registry";
import { CLUSTER_LABEL, type BlogPost } from "./types";
import { SITE_URL, pageUrl } from "@/lib/seo";

const ORG = { "@id": `${SITE_URL}/#organization` };

export const BLOG_PATH = "/blog";
export const blogUrl = () => pageUrl(BLOG_LOCALE, BLOG_PATH);
export const postPath = (slug: string) => `${BLOG_PATH}/${slug}`;
export const postUrl = (slug: string) => pageUrl(BLOG_LOCALE, postPath(slug));
export const feedUrl = () => `${blogUrl()}/feed.xml`;

const blogId = () => `${blogUrl()}#blog`;

/** BlogPosting + BreadcrumbList + FAQPage for one post. */
export function postStructuredData(post: BlogPost) {
  const url = postUrl(post.slug);
  return [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      headline: post.title,
      description: post.description,
      inLanguage: "pt-BR",
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      wordCount: wordCount(post),
      timeRequired: `PT${readingMinutes(post)}M`,
      articleSection: CLUSTER_LABEL[post.cluster],
      keywords: post.keywords.join(", "),
      // The share card generated for this post (app/[locale]/blog/[slug]/opengraph-image.tsx).
      image: `${url}/opengraph-image`,
      author: ORG,
      publisher: ORG,
      isPartOf: { "@type": "Blog", "@id": blogId() },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Corvo", item: pageUrl(BLOG_LOCALE) },
        { "@type": "ListItem", position: 2, name: "Blog", item: blogUrl() },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
    ...(post.faq.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: post.faq.map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: { "@type": "Answer", text: plain(item.a) },
            })),
          },
        ]
      : []),
  ];
}

export const BLOG_TITLE = "Blog da Corvo: como emitir nota fiscal de serviço (NFS-e)";
export const BLOG_DESCRIPTION =
  "Guias simples para MEI e empresas do Simples Nacional emitirem a nota fiscal de serviço (NFS-e): regras, certificado digital, planilha, agenda e IA.";

/** Blog + ItemList + BreadcrumbList for the index. */
export function indexStructuredData() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Blog",
      "@id": blogId(),
      name: "Blog da Corvo",
      description: BLOG_DESCRIPTION,
      url: blogUrl(),
      inLanguage: "pt-BR",
      publisher: ORG,
      blogPost: POSTS.map((post) => ({
        "@type": "BlogPosting",
        headline: post.title,
        url: postUrl(post.slug),
        datePublished: post.publishedAt,
        dateModified: post.updatedAt,
        description: post.description,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: POSTS.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: postUrl(post.slug),
        name: post.title,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Corvo", item: pageUrl(BLOG_LOCALE) },
        { "@type": "ListItem", position: 2, name: "Blog", item: blogUrl() },
      ],
    },
  ];
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS 2.0 for readers, aggregators and AI tools that follow feeds. */
export function buildFeed(): string {
  const latest = POSTS.reduce((max, post) => (post.updatedAt > max ? post.updatedAt : max), POSTS[0]?.updatedAt ?? "1970-01-01");
  const items = POSTS.map(
    (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${postUrl(post.slug)}</link>
      <guid isPermaLink="true">${postUrl(post.slug)}</guid>
      <pubDate>${new Date(`${post.publishedAt}T12:00:00Z`).toUTCString()}</pubDate>
      <category>${escapeXml(CLUSTER_LABEL[post.cluster])}</category>
      <description>${escapeXml(post.description)}</description>
    </item>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog da Corvo</title>
    <link>${blogUrl()}</link>
    <description>${escapeXml(BLOG_DESCRIPTION)}</description>
    <language>pt-BR</language>
    <lastBuildDate>${new Date(`${latest}T12:00:00Z`).toUTCString()}</lastBuildDate>
    <atom:link href="${feedUrl()}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}
