import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CorvoWordmark } from "@/components/ui/corvo-logo";
import { JsonLd } from "@/components/seo/json-ld";
import { pageMetadata, pageUrl, seoLocale } from "@/lib/seo";
import { SIGNUP_HREF, START_COPY, START_PATH, START_SNIPPET } from "@/lib/start-page";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const copy = START_COPY[locale];
  return pageMetadata({ locale, path: START_PATH, title: copy.metaTitle, description: copy.description });
}

export default async function StartPage({ params }: Props) {
  const locale = seoLocale((await params).locale);
  setRequestLocale(locale);
  const copy = START_COPY[locale];
  const free = await getTranslations({ locale, namespace: "FreeTrial" });

  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: copy.title,
    description: copy.description,
    inLanguage: locale === "pt" ? "pt-BR" : "en",
    url: pageUrl(locale, START_PATH),
    step: copy.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.body,
      ...(step.href ? { url: pageUrl(locale, step.href) } : {}),
    })),
  };

  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <JsonLd data={howTo} />
      <nav className="border-b border-border-soft px-6 sm:px-10 py-4 flex items-center justify-between">
        <Link href={`/${locale}`} aria-label={copy.backToHome}>
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link href={`/${locale}/docs`} className="text-sm text-text-3 hover:text-text transition-colors">
          {copy.docsLabel}
        </Link>
      </nav>

      <main className="max-w-[760px] mx-auto px-6 sm:px-10 py-16">
        <span className="font-mono text-[11px] text-accent tracking-[0.1em] mb-3 block">{copy.eyebrow}</span>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] mb-3">{copy.title}</h1>
        <p className="text-[15px] text-text-3 leading-relaxed mb-10">{copy.intro}</p>

        <section aria-labelledby="free-plan" className="mb-12 rounded-[12px] border border-border-soft p-6">
          <h2 id="free-plan" className="text-[18px] font-semibold mb-1">{free("title")}</h2>
          <p className="text-[14px] text-text-3 mb-2">{free("subtitle")}</p>
          <p className="text-[14px] text-text-2 leading-relaxed mb-2">{free("description")}</p>
          <p className="text-[12px] text-text-3">{free("finePrint")}</p>
        </section>

        <section aria-labelledby="steps" className="mb-12">
          <h2 id="steps" className="text-[20px] font-semibold mb-6">{copy.stepsTitle}</h2>
          <ol className="flex flex-col gap-6">
            {copy.steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="font-mono text-accent text-[14px] mt-0.5">{index + 1}.</span>
                <div>
                  <h3 className="text-[16px] font-medium mb-1">
                    {step.href ? (
                      <Link href={`/${locale}${step.href}`} className="hover:underline">
                        {step.title}
                      </Link>
                    ) : (
                      step.title
                    )}
                  </h3>
                  <p className="text-[14px] text-text-3 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="snippet" className="mb-12">
          <h2 id="snippet" className="text-[20px] font-semibold mb-4">{copy.snippetTitle}</h2>
          <pre className="overflow-x-auto rounded-[10px] border border-border-soft bg-white/[0.02] p-4 text-[13px] font-mono leading-relaxed">
            <code>{START_SNIPPET}</code>
          </pre>
        </section>

        <Link
          href={SIGNUP_HREF}
          className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] px-5 py-2.5 rounded-[8px] text-[14px] font-medium transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:opacity-90"
        >
          {free("startFree")}
        </Link>
      </main>
    </div>
  );
}
