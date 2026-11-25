import type { Metadata } from "next";
import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { CorvoWordmark } from "@/components/ui/corvo-logo";
import { JsonLd } from "@/components/seo/json-ld";
import { API_DOCS_COPY, API_DOCS_PATH, apiReference } from "@/lib/api-reference";
import { SITE_URL, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";
import { breadcrumbList, docsCrumbs } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

/** `code` spans from the docs registry, shown as inline code. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={index} className="font-mono text-[0.92em] text-text">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const copy = API_DOCS_COPY[locale];
  return pageMetadata({ locale, path: API_DOCS_PATH, title: copy.title, description: copy.description, type: "article" });
}

export default async function ApiDocsPage({ params }: Props) {
  const locale = seoLocale((await params).locale);
  setRequestLocale(locale);
  const copy = API_DOCS_COPY[locale];
  const { sections, errorTables } = apiReference(locale);

  const structured = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: copy.title,
    description: copy.description,
    url: pageUrl(locale, API_DOCS_PATH),
    inLanguage: locale === "pt" ? "pt-BR" : "en",
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };
  const breadcrumb = breadcrumbList(docsCrumbs(locale, { name: copy.title, url: pageUrl(locale, API_DOCS_PATH) }));

  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <JsonLd data={[structured, breadcrumb]} />
      <nav className="border-b border-border-soft px-6 sm:px-10 py-4 flex items-center justify-between">
        <Link href={`/${locale}`} aria-label="Corvo">
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link href={`/${locale}/docs`} className="text-sm text-text-3 hover:text-text transition-colors">
          Docs
        </Link>
      </nav>
      <main className="max-w-[1000px] mx-auto px-6 sm:px-10 py-14">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] mb-3">{copy.title}</h1>
        <p className="text-[15px] text-text-3 leading-relaxed mb-10">
          <Inline text={copy.intro} />
        </p>

        {sections.map((section) => (
          <section key={section.slug} id={section.slug} className="mb-12">
            <h2 className="text-[20px] font-semibold mb-2">{section.title}</h2>
            <Link href={`/${locale}/docs/${section.slug}`} className="text-[13px] text-accent hover:underline">
              {copy.more}
            </Link>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="text-left text-text-3 border-b border-border-soft">
                    <th className="py-2 pr-4">{copy.method}</th>
                    <th className="py-2 pr-4">{copy.endpoint}</th>
                    <th className="py-2 pr-4">{copy.success}</th>
                    <th className="py-2">{copy.summary}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.endpoints.map((endpoint) => (
                    <tr key={`${endpoint.method} ${endpoint.path}`} className="border-b border-border-soft align-top">
                      <td className="py-2 pr-4 font-mono">{endpoint.method}</td>
                      <td className="py-2 pr-4 font-mono">{endpoint.path}</td>
                      <td className="py-2 pr-4 font-mono">{endpoint.success}</td>
                      <td className="py-2 text-text-2">
                        <Inline text={endpoint.summary} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <section id="errors" className="mb-12">
          <h2 className="text-[20px] font-semibold mb-2">{copy.errors}</h2>
          <Link href={`/${locale}/docs/errors`} className="text-[13px] text-accent hover:underline">
            {copy.more}
          </Link>
          {errorTables.map((table, index) => (
            <div key={index} className="overflow-x-auto mt-4">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="text-left text-text-3 border-b border-border-soft">
                    {table.head.map((cell) => (
                      <th key={cell} className="py-2 pr-4">{cell}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border-soft align-top">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="py-2 pr-4">
                          <Inline text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
