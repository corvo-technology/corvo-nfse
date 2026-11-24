import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { Providers } from "../providers";
import { CookieConsentWrapper } from "@/components/CookieConsentWrapper";
import { ToastProvider } from "@/components/ui/toast";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import { fetchDeploymentConfig } from "@/lib/deployment-config";
import { SupportContactsProvider } from "@/lib/support-contacts-context";
import { readSupportContacts } from "@/lib/support-contacts";
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
  const config = await fetchDeploymentConfig();
  // Read on every request so the owner can change the contacts without a rebuild.
  const support = readSupportContacts();
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <CookieConsentWrapper />
          <Providers>
            <DeploymentConfigProvider config={config}>
              <SupportContactsProvider contacts={support}>
                <ToastProvider>{children}</ToastProvider>
              </SupportContactsProvider>
            </DeploymentConfigProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
