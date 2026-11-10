/** Topic clusters. Each post belongs to one; related posts and the index chips use it. */
export type BlogCluster = "basico" | "regras" | "rotina" | "ia";

export const CLUSTER_LABEL: Record<BlogCluster, string> = {
  basico: "Primeiros passos",
  regras: "Regras e prazos",
  rotina: "No dia a dia",
  ia: "Com inteligência artificial",
};

/**
 * Body blocks. Inline text supports `code`, **bold** and [label](href).
 * Internal hrefs start with "/" and must carry the locale (for example /pt/docs/invoices).
 */
export type BlogBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; label?: string; language: string; code: string }
  | { kind: "callout"; tone: "accent" | "warn"; text: string };

export interface BlogFaq {
  q: string;
  a: string;
}

export interface BlogPost {
  /** URL slug under /pt/blog/. Lowercase, hyphenated, never changes after publishing. */
  slug: string;
  /** H1 shown on the page. */
  title: string;
  /** <title> without the site suffix. Keep it under 60 characters. */
  seoTitle: string;
  /** Meta description and card excerpt. 120 to 160 characters. */
  description: string;
  /** ISO dates (yyyy-mm-dd). `updatedAt` changes only when the content really changes. */
  publishedAt: string;
  updatedAt: string;
  cluster: BlogCluster;
  keywords: string[];
  /** Direct answer shown first, in two or three sentences. Quotable by search engines and AI answers. */
  answer: string;
  blocks: BlogBlock[];
  faq: BlogFaq[];
  /** Slugs of the posts to suggest next, in order. */
  readNext: string[];
}
