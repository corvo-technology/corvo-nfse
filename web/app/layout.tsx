import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { Providers } from "./providers";
import { CookieConsentWrapper } from "@/components/CookieConsentWrapper";
import { ToastProvider } from "@/components/ui/toast";
import { OG_IMAGE_PATH, SITE_COPY, SITE_URL } from "@/lib/seo";
import "./globals.css";

const siteUrl = SITE_URL;
// Fallback only (login, dashboard, errors): marketing pages set their own metadata per language.
const fallback = SITE_COPY.en;

export const metadata: Metadata = {
  title: {
    default: fallback.title,
    template: "%s | Corvo",
  },
  description: fallback.description,
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
    title: fallback.title,
    description: fallback.description,
    siteName: "Corvo",
    type: "website",
    images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt: fallback.ogAlt, type: "image/png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: fallback.title,
    description: fallback.description,
    images: [OG_IMAGE_PATH],
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
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
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
      className="h-full antialiased"
    >
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
