import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import { SITE_URL, pageUrl, type SeoLocale } from "@/lib/seo";
import { REPO_URL } from "@/lib/repo";

/**
 * The landing FAQ, in one place for the three ways it is read: the visible section, the schema.org
 * FAQPage and llms.txt. They all take the texts from the same message files, so the structured data
 * always says what the page says (Google requires that).
 */
export const FAQ_ITEMS = [
  { id: "coverage", path: "/docs/municipalities" },
  { id: "issues", path: "/docs" },
  // The visible link goes to the pricing section of the landing; machines get the landing itself.
  { id: "companies", path: "", anchor: "#pricing" },
  { id: "payments", path: "/docs/payment-integrations" },
  // The SDK answer also covers the MCP server for AI agents, so it carries a second link.
  { id: "sdks", path: "/docs/sdks", extra: { path: "/docs/mcp" } },
  // The code lives on GitHub, so this answer links outside the site.
  { id: "opensource", path: "", external: REPO_URL },
] as const;

export type FaqId = (typeof FAQ_ITEMS)[number]["id"];

const MESSAGES = { en, pt } as const;

export interface FaqEntry {
  id: FaqId;
  question: string;
  answer: string;
  linkLabel: string;
  /** Absolute URL of the page that goes deeper. */
  url: string;
  /** A second page the answer points at, when it covers two things. */
  extra?: { label: string; url: string };
}

export function landingFaq(locale: SeoLocale): FaqEntry[] {
  const copy = MESSAGES[locale].LandingFaq.items;
  return FAQ_ITEMS.map((item) => {
    const text = copy[item.id] as { q: string; a: string; link: string; link2?: string };
    return {
      id: item.id,
      question: text.q,
      answer: text.a,
      linkLabel: text.link,
      url: "external" in item ? item.external : pageUrl(locale, item.path),
      ...("extra" in item && text.link2 ? { extra: { label: text.link2, url: pageUrl(locale, item.extra.path) } } : {}),
    };
  });
}

/** schema.org FAQPage for the landing of the given language. */
export function faqPageJsonLd(locale: SeoLocale): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${pageUrl(locale)}#faq`,
    url: pageUrl(locale),
    inLanguage: locale === "pt" ? "pt-BR" : "en",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntity: landingFaq(locale).map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer, url: entry.url },
    })),
  };
}

/** The FAQ as markdown, for llms.txt and llms-full.txt. */
export function faqMarkdown(locale: SeoLocale): string {
  return landingFaq(locale)
    .map((entry) => `### ${entry.question}\n\n${entry.answer} [${entry.linkLabel}](${entry.url})${entry.extra ? ` [${entry.extra.label}](${entry.extra.url})` : ""}`)
    .join("\n\n");
}
