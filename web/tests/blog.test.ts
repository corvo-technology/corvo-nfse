import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { plain } from "@/lib/blog/inline";
import { POSTS, POST_SLUGS, readingMinutes, relatedPosts, slugifyHeading, tableOfContents, wordCount } from "@/lib/blog/registry";
import { buildFeed, feedUrl, indexStructuredData, postStructuredData, postUrl } from "@/lib/blog/seo";
import { DOC_SLUGS } from "@/lib/docs/registry";

const internalLinks = (text: string) => [...text.matchAll(/\]\((\/[^)\s]+)\)/g)].map((match) => match[1]);

function textsOf(post: (typeof POSTS)[number]): string[] {
  const out = [post.answer, ...post.faq.map((item) => item.a)];
  for (const block of post.blocks) {
    if ("text" in block) out.push(block.text);
    if ("items" in block) out.push(...block.items);
    if (block.kind === "table") out.push(...block.rows.flat());
  }
  return out;
}

describe("blog content", () => {
  it("has unique, url-safe slugs and a stable order (newest first)", () => {
    expect(new Set(POST_SLUGS).size).toBe(POST_SLUGS.length);
    for (const slug of POST_SLUGS) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const dates = POSTS.map((post) => post.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  for (const post of POSTS) {
    describe(post.slug, () => {
      it("has search-friendly metadata", () => {
        expect(post.seoTitle.length).toBeLessThanOrEqual(60);
        expect(post.description.length).toBeGreaterThanOrEqual(110);
        expect(post.description.length).toBeLessThanOrEqual(175);
        expect(post.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(post.updatedAt >= post.publishedAt).toBe(true);
        expect(post.keywords.length).toBeGreaterThanOrEqual(4);
      });

      it("answers first, has a FAQ and enough substance", () => {
        expect(plain(post.answer).split(/\s+/).length).toBeLessThanOrEqual(80);
        expect(post.faq.length).toBeGreaterThanOrEqual(4);
        for (const item of post.faq) expect(item.q.endsWith("?")).toBe(true);
        expect(wordCount(post)).toBeGreaterThanOrEqual(850);
        expect(readingMinutes(post)).toBeGreaterThanOrEqual(4);
      });

      it("has a table of contents with unique anchors", () => {
        const ids = tableOfContents(post).map((entry) => entry.id);
        expect(ids.length).toBeGreaterThanOrEqual(5);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toBe(slugifyHeading(id));
      });

      it("only links to pages that exist", () => {
        for (const href of textsOf(post).flatMap(internalLinks)) {
          const [, locale, section, slug] = href.split("#")[0].split("/");
          expect(locale, href).toBe("pt");
          if (section === "blog") expect(POST_SLUGS, href).toContain(slug);
          else if (section === "docs") expect(slug === undefined || DOC_SLUGS.includes(slug as never), href).toBe(true);
        }
        for (const slug of post.readNext) expect(POST_SLUGS).toContain(slug);
      });

      it("suggests other posts, never itself", () => {
        const related = relatedPosts(post);
        expect(related.length).toBeGreaterThan(0);
        expect(related.map((item) => item.slug)).not.toContain(post.slug);
      });

      it("emits BlogPosting, BreadcrumbList and FAQPage structured data", () => {
        const data = postStructuredData(post);
        expect(data.map((item) => item["@type"])).toEqual(["BlogPosting", "BreadcrumbList", "FAQPage"]);
        const article = data[0] as Record<string, unknown>;
        expect(article.url).toBe(postUrl(post.slug));
        expect(article.datePublished).toBe(post.publishedAt);
        expect(article.dateModified).toBe(post.updatedAt);
        expect(article.inLanguage).toBe("pt-BR");
        const faq = data[2] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
        expect(faq.mainEntity).toHaveLength(post.faq.length);
        expect(faq.mainEntity[0].acceptedAnswer.text).not.toMatch(/[`*]|\]\(/);
      });
    });
  }
});

describe("blog discovery", () => {
  it("lists every post in the index structured data", () => {
    const [blog, list] = indexStructuredData() as unknown as [{ blogPost: unknown[] }, { itemListElement: unknown[] }];
    expect(blog.blogPost).toHaveLength(POSTS.length);
    expect(list.itemListElement).toHaveLength(POSTS.length);
  });

  it("builds a valid RSS feed with an absolute self link", () => {
    const feed = buildFeed();
    expect(feed.startsWith("<?xml")).toBe(true);
    expect(feed).toContain(`<atom:link href="${feedUrl()}" rel="self"`);
    expect((feed.match(/<item>/g) ?? []).length).toBe(POSTS.length);
    expect(feed).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it("puts the blog in the sitemap in Portuguese only, with matching hreflang", () => {
    const entries = sitemap().filter((entry) => entry.url.includes("/blog"));
    expect(entries).toHaveLength(POSTS.length + 1);
    for (const entry of entries) {
      expect(entry.url).toContain("/pt/blog");
      expect(entry.alternates?.languages).toEqual({ pt: entry.url, "x-default": entry.url });
    }
    expect(sitemap().some((entry) => entry.url.includes("/en/blog"))).toBe(false);
  });
});
