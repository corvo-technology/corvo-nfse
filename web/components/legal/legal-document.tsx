import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

type LegalNamespace = "Terms" | "Privacy" | "Dpa";

interface LegalSection {
  title: string;
  content: string;
}

const documents = [
  { namespace: "Terms", slug: "terms", label: "terms" },
  { namespace: "Privacy", slug: "privacy", label: "privacy" },
  { namespace: "Dpa", slug: "dpa", label: "dpa" },
] as const;

export async function legalMetadata(
  locale: string,
  namespace: LegalNamespace,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace });
  const slug = documents.find((document) => document.namespace === namespace)!.slug;

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `/${locale}/${slug}`,
      languages: { pt: `/pt/${slug}`, en: `/en/${slug}` },
    },
  };
}

export async function LegalDocument({
  locale,
  namespace,
}: {
  locale: string;
  namespace: LegalNamespace;
}) {
  const t = await getTranslations({ locale, namespace });
  const legal = await getTranslations({ locale, namespace: "Legal" });
  const sections = t.raw("sections") as Record<string, LegalSection>;

  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <nav className="border-b border-border-soft px-6 md:px-10 py-4 flex items-center justify-between">
        <Link href={`/${locale}`} aria-label={legal("backToHome")}>
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link href={`/${locale}`} className="text-sm text-text-3 hover:text-text transition-colors">
          {legal("backToHome")}
        </Link>
      </nav>
      <main className="max-w-[760px] mx-auto px-6 md:px-10 py-16">
        <span className="font-mono text-[11px] text-accent tracking-[0.1em] mb-3 block">
          {legal("eyebrow")}
        </span>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] mb-2">{t("title")}</h1>
        <p className="text-[15px] text-text-3 mb-3">{t("effectiveDate")}</p>
        <p className="text-[14.5px] text-text-2 leading-[1.65] mb-6">{t("description")}</p>
        <nav aria-label={legal("navigation")} className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] mb-10">
          {documents.map((document) => (
            <Link
              key={document.slug}
              href={`/${locale}/${document.slug}`}
              aria-current={namespace === document.namespace ? "page" : undefined}
              className="text-accent hover:underline"
            >
              {legal(document.label)}
            </Link>
          ))}
          <Link href={`/${locale}/security`} className="text-accent hover:underline">
            {legal("security")}
          </Link>
        </nav>
        <div className="flex flex-col gap-8">
          {Object.entries(sections).map(([key, section]) => (
            <section key={key} aria-labelledby={`section-${key}`}>
              <h2 id={`section-${key}`} className="text-[15px] font-semibold mb-2">{section.title}</h2>
              <p className="text-[14.5px] text-text-2 leading-[1.65]">{section.content}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
