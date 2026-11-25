import type { Metadata } from "next";

/**
 * Public origin. The apex (`https://corvo.tech`) already 301s here at the edge;
 * sitemaps, canonicals and in-app redirects must keep using this host.
 */
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
      "REST API to issue Brazilian NFS-e: MEI and Simples Nacional, tax calculation, multi-company, webhooks and AI agents (MCP). The first invoice is free.",
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
      "API REST para emitir NFS-e: MEI e Simples Nacional, cálculo de tributos, multiempresa, webhooks e agentes de IA (MCP). A primeira nota é grátis.",
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
  /** false: the page has its own opengraph-image/twitter-image file, which Next adds; no site-wide image here. */
  sharedImage?: boolean;
}

const TITLE_TAIL: Record<SeoLocale, string> = { en: " — NFS-e API", pt: " — API de NFS-e" };
const DESCRIPTION_TAIL: Record<SeoLocale, string[]> = {
  en: [" Corvo is a REST API to issue Brazilian NFS-e for MEI and Simples Nacional.", " The first invoice is free."],
  pt: [" A Corvo é uma API REST para emitir NFS-e de MEI e Simples Nacional.", " A primeira nota é grátis."],
};
const MIN_TITLE = 30;
const MAX_TITLE = 60;
const MIN_DESCRIPTION = 120;
const MAX_DESCRIPTION = 160;

/** Title of at least 30 characters (with " | Corvo"): a short one gets the product tail. */
export function fitTitle(title: string, locale: SeoLocale, absolute = false): string {
  const length = absolute ? title.length : `${title} | ${SITE_NAME}`.length;
  return length < MIN_TITLE ? `${title}${TITLE_TAIL[locale]}` : title;
}

/** Description between 120 and 160 characters: short ones get product sentences, long ones are cut at a word. */
export function fitDescription(description: string, locale: SeoLocale): string {
  let text = description.trim();
  for (const tail of DESCRIPTION_TAIL[locale]) {
    if (text.length >= MIN_DESCRIPTION) break;
    if ((text + tail).length <= MAX_DESCRIPTION) text += tail;
  }
  if (text.length <= MAX_DESCRIPTION) return text;
  const cut = text.slice(0, MAX_DESCRIPTION - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\s]+$/, "")}…`;
}

/** Metadata with canonical, hreflang, Open Graph and Twitter cards in the page's language. */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const locale = input.onlyLocale ?? seoLocale(input.locale);
  const copy = SITE_COPY[locale];
  const path = input.path ?? "";
  const title = fitTitle(input.title, locale, input.absoluteTitle);
  const description = fitDescription(input.description, locale);
  const shownTitle = input.absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  const other = input.onlyLocale
    ? []
    : SEO_LOCALES.filter((value) => value !== locale).map((value) => OPEN_GRAPH_LOCALE[value]);
  return {
    title: input.absoluteTitle ? { absolute: title } : title,
    description,
    ...(input.keywords ? { keywords: input.keywords } : {}),
    alternates: localizedAlternates(locale, path, input.onlyLocale),
    openGraph: {
      type: input.type ?? "website",
      siteName: SITE_NAME,
      title: shownTitle,
      description,
      url: pageUrl(locale, path),
      locale: OPEN_GRAPH_LOCALE[locale],
      alternateLocale: other,
      ...(input.sharedImage === false ? {} : { images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt: copy.ogAlt, type: "image/png" }] }),
    },
    twitter: {
      card: "summary_large_image",
      title: shownTitle,
      description,
      ...(input.sharedImage === false ? {} : { images: [OG_IMAGE_PATH] }),
    },
  };
}
