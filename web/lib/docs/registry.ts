// lib/docs/registry.ts
import { en } from "./content/en";
import { pt } from "./content/pt";
import type { DocsLocale, DocsTree } from "./types";

export { DOC_GROUPS, DOC_SLUGS } from "./slugs";

const TREES: Record<DocsLocale, DocsTree> = { en, pt };

export function getDocsTree(locale: string): DocsTree | null {
  return locale === "en" || locale === "pt" ? TREES[locale] : null;
}
