import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

export default async function SecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Security" });
  const legal = await getTranslations({ locale, namespace: "Legal" });

  const practices = [
    {
      title: t("practices.encryptionTransit.title"),
      description: t("practices.encryptionTransit.description"),
    },
    {
      title: t("practices.encryptionRest.title"),
      description: t("practices.encryptionRest.description"),
    },
    {
      title: t("practices.hmacWebhooks.title"),
      description: t("practices.hmacWebhooks.description"),
    },
    {
      title: t("practices.documentStorage.title"),
      description: t("practices.documentStorage.description"),
    },
    {
      title: t("practices.accessControl.title"),
      description: t("practices.accessControl.description"),
    },
    {
      title: t("practices.dataProtection.title"),
      description: t("practices.dataProtection.description"),
    },
  ];

  const disclosures = [
    {
      title: t("disclosures.reporting.title"),
      description: t("disclosures.reporting.description"),
    },
    {
      title: t("disclosures.credentials.title"),
      description: t("disclosures.credentials.description"),
    },
  ];

  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <nav className="border-b border-border-soft px-10 py-4 flex items-center justify-between">
        <Link href={`/${locale}`} aria-label={t("backToHome")}>
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link
          href={`/${locale}`}
          className="text-sm text-text-3 hover:text-text transition-colors"
        >
          {t("backToHome")}
        </Link>
      </nav>

      <main className="max-w-[720px] mx-auto px-10 py-16">
        <span className="font-mono text-[11px] text-accent tracking-[0.1em] mb-3 block">
          {t("eyebrow")}
        </span>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] mb-2">
          {t("title")}
        </h1>
        <p className="text-[15px] text-text-3 mb-10 max-w-[520px]">
          {t("description")}
        </p>
        <nav aria-label={legal("navigation")} className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] mb-10">
          {(["terms", "privacy", "dpa"] as const).map((slug) => (
            <Link key={slug} href={`/${locale}/${slug}`} className="text-accent hover:underline">
              {legal(slug)}
            </Link>
          ))}
        </nav>

        {/* Practices */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {practices.map((item) => (
            <div
              key={item.title}
              className="border border-border rounded-xl bg-surface p-5"
            >
              <h3 className="text-[14.5px] font-medium mb-1.5">
                {item.title}
              </h3>
              <p className="text-[13.5px] text-text-3 leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        {/* Disclosures */}
        <h2 className="text-[15px] font-semibold mb-4">
          {t("responsibleDisclosure")}
        </h2>
        <div className="border border-border rounded-xl bg-surface overflow-hidden">
          {disclosures.map((item) => (
            <div
              key={item.title}
              className="px-5 py-4 border-b border-[#151515] last:border-b-0"
            >
              <h3 className="text-[14.5px] font-medium mb-1">{item.title}</h3>
              <p className="text-[13.5px] text-text-3">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Contact */}
        <div className="mt-10 border border-accent-border rounded-xl bg-accent-surface p-5">
          <p className="text-[14.5px]">
            {t("questions")}{" "}
            <a
              href="mailto:security@corvo.tech"
              className="text-accent hover:underline"
            >
              security@corvo.tech
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
