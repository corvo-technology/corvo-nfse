import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { Providers } from "../providers";
import { CookieConsentWrapper } from "@/components/CookieConsentWrapper";
import { ToastProvider } from "@/components/ui/toast";
import { rootMetadata, rootViewport } from "@/lib/root-metadata";
import "../globals.css";

export const metadata = rootMetadata;
export const viewport = rootViewport;

/**
 * Root layout for the dashboard, login and agent consent screens. These pages
 * have no locale in the URL, so the language comes from the NEXT_LOCALE cookie.
 * Marketing pages and docs live under app/[locale] with their own static root layout.
 */
export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = cookieStore.get("NEXT_LOCALE")?.value === "pt" ? "pt" : "en";
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return (
    <html lang={locale} className="h-full antialiased">
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
