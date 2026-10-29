import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LandingPage } from "@/components/landing/landing-page";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageJsonLd } from "@/lib/landing-faq";
import { paidPlanOffers } from "@/lib/pricing-jsonld";
import { SITE_COPY, SITE_URL, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const copy = SITE_COPY[locale];
  return pageMetadata({
    locale,
    title: copy.title,
    absoluteTitle: true,
    description: copy.description,
    keywords: copy.keywords,
  });
}

export default async function Page({ params }: Props) {
  const locale = seoLocale((await params).locale);
  setRequestLocale(locale);
  const copy = SITE_COPY[locale];

  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: "Corvo",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "NFS-e API",
    operatingSystem: "Web",
    description: copy.tagline,
    url: pageUrl(locale),
    inLanguage: locale === "pt" ? "pt-BR" : "en",
    provider: { "@id": `${SITE_URL}/#organization` },
    featureList:
      locale === "pt"
        ? [
            "Emissão de NFS-e pelo padrão nacional",
            "MEI e Simples Nacional",
            "Cálculo de tributos antes de emitir",
            "Várias empresas na mesma conta",
            "Webhooks e envio de XML e PDF por e-mail",
            "Agentes de IA via MCP",
          ]
        : [
            "NFS-e issuance on the national standard",
            "MEI and Simples Nacional",
            "Tax calculation before issuing",
            "Multiple companies in one account",
            "Webhooks and XML/PDF delivery by email",
            "AI agents through MCP",
          ],
    offers: [
      {
        "@type": "Offer",
        name: locale === "pt" ? "Grátis: 15 notas por mês" : "Free: 15 invoices a month",
        price: "0",
        priceCurrency: "BRL",
        url: pageUrl(locale),
      },
      ...paidPlanOffers(locale),
    ],
  };

  return (
    <>
      <JsonLd data={software} />
      <JsonLd data={faqPageJsonLd(locale)} />
      <LandingPage />
    </>
  );
}
