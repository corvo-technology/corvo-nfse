import { DOC_GROUPS, getDocsTree } from "@/lib/docs/registry";
import { sectionToMarkdown } from "@/lib/docs/to-markdown";
import { SITE_COPY, SITE_URL } from "@/lib/seo";

export const dynamic = "force-static";

/** The whole English documentation in one Markdown file, for LLM tools. */
export function GET() {
  const tree = getDocsTree("en")!;
  const slugs = DOC_GROUPS.flatMap((group) => group.slugs);
  const body = [
    `# Corvo API documentation\n\n> ${SITE_COPY.en.tagline}\n\nBase URL: https://api.corvo.tech/v1 · MCP: https://api.corvo.tech/mcp · Site: ${SITE_URL}`,
    sectionToMarkdown(tree.home, 2),
    ...slugs.map((slug) => `${sectionToMarkdown(tree.pages[slug], 2)}\n\nSource: ${SITE_URL}/en/docs/${slug}`),
  ].join("\n\n---\n\n");
  return new Response(`${body}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
