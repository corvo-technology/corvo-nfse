import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { Providers } from "./providers";
import { CookieConsentWrapper } from "@/components/CookieConsentWrapper";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const siteUrl = "https://corvo.tech";
const siteDescription =
  "Automatize a emissão de NFS-e com a Corvo. Uma API REST para desenvolvedores, SaaS e ERPs, com gestão multiempresa e envio de notas por e-mail.";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Corvo — API de Notas Fiscais para Desenvolvedores",
    template: "%s | Corvo",
  },
  description: siteDescription,
  keywords: [
    "API NFS-e",
    "API de notas fiscais",
    "emissão de nota fiscal por API",
    "automação de notas fiscais",
    "API para SaaS",
    "emissão NFS-e",
    "integração fiscal",
    "NFS-e API",
    "desenvolvedores",
  ],
  authors: [{ name: "Corvo Tech" }],
  creator: "Corvo Tech",
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    other: [{ url: "/icon-512.png", sizes: "512x512", type: "image/png" }],
  },
  openGraph: {
    title: "Corvo — API de Notas Fiscais para Desenvolvedores",
    description: siteDescription,
    url: siteUrl,
    siteName: "Corvo",
    type: "website",
    locale: "pt_BR",
    images: [
      {
        url: "/og-1200x630.png",
        width: 1200,
        height: 630,
        alt: "Corvo — API de notas fiscais para desenvolvedores",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Corvo — API de Notas Fiscais para Desenvolvedores",
    description: siteDescription,
    images: ["/og-1200x630.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: siteUrl,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "Corvo Tech",
      url: siteUrl,
      logo: `${siteUrl}/icon-512.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: "Corvo",
      url: siteUrl,
      inLanguage: "pt-BR",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#software`,
      name: "Corvo",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: siteDescription,
      url: siteUrl,
      provider: { "@id": `${siteUrl}/#organization` },
    },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = cookieStore.get("NEXT_LOCALE")?.value === "pt" ? "pt" : "en";
  const messages = (await import(`../messages/${locale}.json`)).default;

  return (
    <html
      lang={locale}
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <CookieConsentWrapper />
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>
            <ToastProvider>{children}</ToastProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
