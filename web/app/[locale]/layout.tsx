import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE_COPY, SITE_NAME, SITE_URL, seoLocale } from "@/lib/seo";
import type { Metadata } from "next";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** Defaults for pages without their own metadata (brand, status); pages set canonical themselves. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const copy = SITE_COPY[seoLocale((await params).locale)];
  return { description: copy.description, keywords: copy.keywords };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  const language = locale === "pt" ? "pt-BR" : "en";
  const identity = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Corvo Tech",
        url: SITE_URL,
        logo: `${SITE_URL}/icon-512.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: `${SITE_URL}/${locale}`,
        inLanguage: language,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <NextIntlClientProvider messages={messages}>
      <JsonLd data={identity} />
      {children}
    </NextIntlClientProvider>
  );
}
