import type { DocGroupKey, DocSlug } from "./types";

/** Published docs paths. Split from the content trees so redirects can import it without the page bodies. */
export const DOC_GROUPS: { key: DocGroupKey; slugs: DocSlug[] }[] = [
  { key: "gettingStarted", slugs: ["sdks", "authentication", "errors", "rate-limits"] },
  {
    key: "reference",
    slugs: ["companies", "certificates", "invoices", "imports", "webhooks", "billing"],
  },
  {
    key: "guides",
    slugs: ["async-issuance", "pagination", "receiving-webhooks", "integration-checklist", "payment-integrations", "municipalities", "mcp", "llms"],
  },
];

export const DOC_SLUGS = DOC_GROUPS.flatMap((group) => group.slugs);

export const PUBLISHED_DOC_SLUGS = new Set<string>(DOC_SLUGS);
