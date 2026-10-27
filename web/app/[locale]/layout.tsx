import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE_COPY, SITE_NAME, SITE_URL, seoLocale } from "@/lib/seo";
import type { Metadata } from "next";
import { Providers } from "../providers";
import { CookieConsentWrapper } from "@/components/CookieConsentWrapper";
import { ToastProvider } from "@/components/ui/toast";
import { rootMetadata, rootViewport } from "@/lib/root-metadata";
import "../globals.css";

export const viewport = rootViewport;
/** Only en and pt exist; anything else is a 404 without rendering on demand. */
export const dynamicParams = false;
/** Marketing pages and docs are static and refreshed at most once an hour. */
export const revalidate = 3600;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Root layout for marketing pages and docs. It must not read cookies() or
 * headers(): that would make every page render on demand (no CDN cache).
 */

/** Defaults for pages without their own metadata (brand, status); pages set canonical themselves. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const copy = SITE_COPY[seoLocale((await params).locale)];
  return { ...rootMetadata, description: copy.description, keywords: copy.keywords };
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
    <html lang={language} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <CookieConsentWrapper />
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>
            <ToastProvider>
              <JsonLd data={identity} />
              {children}
            </ToastProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
