// lib/docs/registry.ts
import { en } from "./content/en";
import { pt } from "./content/pt";
import type { DocGroupKey, DocSlug, DocsLocale, DocsTree } from "./types";

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

export const DOC_SLUGS = DOC_GROUPS.flatMap((g) => g.slugs);

const TREES: Record<DocsLocale, DocsTree> = { en, pt };

export function getDocsTree(locale: string): DocsTree | null {
  return locale === "en" || locale === "pt" ? TREES[locale] : null;
}
