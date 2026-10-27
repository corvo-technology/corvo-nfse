import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LandingPage } from "@/components/landing/landing-page";
import { JsonLd } from "@/components/seo/json-ld";
import { PLANS } from "@/lib/plans-catalog";
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
    offers: PLANS.map((plan) => {
      const name = plan.slug.charAt(0).toUpperCase() + plan.slug.slice(1);
      const price = (plan.basePriceCents / 100).toFixed(2);
      return {
        "@type": "Offer",
        name: locale === "pt" ? `${name}: ${plan.credits} notas por mês` : `${name}: ${plan.credits} invoices a month`,
        price,
        priceCurrency: "BRL",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price,
          priceCurrency: "BRL",
          unitText: "MON",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
        },
        url: pageUrl(locale),
      };
    }),
  };

  return (
    <>
      <JsonLd data={software} />
      <LandingPage />
    </>
  );
}
