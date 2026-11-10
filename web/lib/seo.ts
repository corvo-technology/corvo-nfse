import type { Metadata } from "next";

export const SITE_URL = "https://www.corvo.tech";
export const SITE_NAME = "Corvo";
export const SEO_LOCALES = ["en", "pt"] as const;
export type SeoLocale = (typeof SEO_LOCALES)[number];
export const DEFAULT_SEO_LOCALE: SeoLocale = "pt";
/** Organization url: one value for both languages, because the @id is shared. */
export const ORGANIZATION_URL = SITE_URL;
/** Official profiles for schema.org sameAs. The X profile is left out until its handle is confirmed in the repo or on the site. */
export const ORGANIZATION_SAME_AS = ["https://github.com/corvo-technology"];
/** Social-sharing card (1200x630), used by Open Graph and Twitter. */
export const OG_IMAGE_PATH = "/og-corvo-1200x630.png";

const OPEN_GRAPH_LOCALE: Record<SeoLocale, string> = { en: "en_US", pt: "pt_BR" };

export interface SiteCopy {
  title: string;
  description: string;
  ogAlt: string;
  keywords: string[];
  /** Short product sentence reused by structured data and llms.txt. */
  tagline: string;
}

export const SITE_COPY: Record<SeoLocale, SiteCopy> = {
  en: {
    title: "Corvo — Brazilian NFS-e API for MEI and Simples Nacional",
    description:
      "REST API to issue Brazilian NFS-e: MEI and Simples Nacional, tax calculation, multi-company, webhooks and AI agents (MCP). 15 free invoices a month.",
    ogAlt: "Corvo — Brazilian NFS-e API for developers",
    tagline:
      "REST API and MCP server to issue Brazilian service invoices (NFS-e) for MEI and Simples Nacional companies.",
    keywords: [
      "NFS-e API",
      "Brazilian invoice API",
      "national NFS-e API",
      "issue NFS-e by API",
      "MEI invoice API",
      "Simples Nacional NFS-e",
      "multi-company invoicing",
      "NFS-e MCP",
      "AI agent invoicing",
      "IBS CBS tax reform NFS-e",
    ],
  },
  pt: {
    title: "Corvo — API de NFS-e para MEI e Simples Nacional",
    description:
      "API REST para emitir NFS-e: MEI e Simples Nacional, cálculo de tributos, multiempresa, webhooks e agentes de IA (MCP). 15 notas grátis por mês.",
    ogAlt: "Corvo — API de NFS-e para desenvolvedores",
    tagline:
      "API REST e servidor MCP para emitir notas fiscais de serviço (NFS-e) de empresas MEI e do Simples Nacional.",
    keywords: [
      "API NFS-e",
      "API de notas fiscais",
      "NFS-e nacional",
      "emissão de NFS-e por API",
      "API nota fiscal MEI",
      "NFS-e Simples Nacional",
      "emissão multiempresa",
      "NFS-e MCP",
      "agente de IA nota fiscal",
      "reforma tributária IBS CBS NFS-e",
    ],
  },
};

export function isSeoLocale(value: string): value is SeoLocale {
  return (SEO_LOCALES as readonly string[]).includes(value);
}

/** Falls back to the default locale for anything unknown. */
export function seoLocale(value: string): SeoLocale {
  return isSeoLocale(value) ? value : DEFAULT_SEO_LOCALE;
}

/** Absolute URL of a localized page. `path` is "" for the home or starts with "/". */
export function pageUrl(locale: SeoLocale, path = ""): string {
  return `${SITE_URL}/${locale}${path}`;
}

/** Canonical plus hreflang for every locale, with the default locale as x-default. */
export function localizedAlternates(locale: SeoLocale, path = "", only?: SeoLocale) {
  // A page that exists in a single language lists only that language, so hreflang never points at a redirect.
  if (only) {
    return {
      canonical: pageUrl(only, path),
      languages: { [only]: pageUrl(only, path), "x-default": pageUrl(only, path) },
    };
  }
  return {
    canonical: pageUrl(locale, path),
    languages: {
      en: pageUrl("en", path),
      pt: pageUrl("pt", path),
      "x-default": pageUrl(DEFAULT_SEO_LOCALE, path),
    },
  };
}

interface PageMetadataInput {
  locale: string;
  /** "" for the home, otherwise "/docs/invoices" etc. */
  path?: string;
  /** Page title; the root layout appends " | Corvo". Use `absoluteTitle` for the home. */
  title: string;
  absoluteTitle?: boolean;
  description: string;
  keywords?: string[];
  type?: "website" | "article";
  /** The page exists in one language only (the blog): canonical and hreflang list just that one. */
  onlyLocale?: SeoLocale;
}

/** Metadata with canonical, hreflang, Open Graph and Twitter cards in the page's language. */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const locale = input.onlyLocale ?? seoLocale(input.locale);
  const copy = SITE_COPY[locale];
  const path = input.path ?? "";
  const shownTitle = input.absoluteTitle ? input.title : `${input.title} | ${SITE_NAME}`;
  const other = input.onlyLocale
    ? []
    : SEO_LOCALES.filter((value) => value !== locale).map((value) => OPEN_GRAPH_LOCALE[value]);
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    ...(input.keywords ? { keywords: input.keywords } : {}),
    alternates: localizedAlternates(locale, path, input.onlyLocale),
    openGraph: {
      type: input.type ?? "website",
      siteName: SITE_NAME,
      title: shownTitle,
      description: input.description,
      url: pageUrl(locale, path),
      locale: OPEN_GRAPH_LOCALE[locale],
      alternateLocale: other,
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt: copy.ogAlt, type: "image/png" }],
    },
    twitter: {
      card: "summary_large_image",
      title: shownTitle,
      description: input.description,
      images: [OG_IMAGE_PATH],
    },
  };
}
