import { SDKS } from "@/lib/sdks";
import { SITE_NAME, SITE_URL, pageUrl, type SeoLocale } from "@/lib/seo";

/** Public contact address, the same one the security page shows. */
export const CONTACT_EMAIL = "contato@corvo.tech";

const ORG_REF = { "@id": `${SITE_URL}/#organization` };

export interface Crumb {
  name: string;
  /** Absolute URL. */
  url: string;
}

/** schema.org BreadcrumbList from ordered crumbs (the first is the site home). */
export function breadcrumbList(crumbs: Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: crumb.url })),
  };
}

/** Home > Docs (> page), in the page's language. */
export function docsCrumbs(locale: SeoLocale, ...rest: Crumb[]): Crumb[] {
  return [
    { name: SITE_NAME, url: pageUrl(locale) },
    { name: locale === "pt" ? "Documentação" : "Docs", url: pageUrl(locale, "/docs") },
    ...rest,
  ];
}

/** One SoftwareSourceCode per official SDK, from the same list the docs page shows. */
export function sdkSourceCode(locale: SeoLocale): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: locale === "pt" ? "SDKs oficiais da Corvo" : "Official Corvo SDKs",
    itemListElement: SDKS.map((sdk, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "SoftwareSourceCode",
        name: sdk.pkg,
        programmingLanguage: sdk.name,
        codeRepository: `https://github.com/corvo-technology/${sdk.repo}`,
        author: ORG_REF,
        publisher: ORG_REF,
      },
    })),
  };
}
