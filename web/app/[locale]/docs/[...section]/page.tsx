import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DocBlocks } from "@/components/docs/doc-blocks";
import { DocsHeader } from "@/components/docs/docs-header";
import { DOC_SLUGS, getDocsTree } from "@/lib/docs/registry";
import type { DocSlug } from "@/lib/docs/types";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbList, docsCrumbs, sdkSourceCode } from "@/lib/structured-data";
import { SITE_COPY, SITE_URL, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";

export function generateStaticParams() {
  return DOC_SLUGS.flatMap((slug) =>
    ["en", "pt"].map((locale) => ({ locale, section: [slug] })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}): Promise<Metadata> {
  const { locale, section } = await params;
  const tree = getDocsTree(locale);
  const page =
    tree && section.length === 1 ? tree.pages[section[0] as DocSlug] : null;
  if (!page) return { title: "Docs", robots: { index: false } };
  return pageMetadata({
    locale,
    path: `/docs/${section[0]}`,
    title: `${page.title} — ${seoLocale(locale) === "pt" ? "Docs da API" : "API docs"}`,
    description: page.description ?? SITE_COPY[seoLocale(locale)].description,
    type: "article",
  });
}

export default async function DocsSectionPage({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}) {
  const { locale, section } = await params;
  setRequestLocale(locale);
  if (section.length !== 1) notFound();
  const tree = getDocsTree(locale);
  if (!tree) notFound();
  const page = tree.pages[section[0] as DocSlug];
  if (!page) notFound();

  const lang = seoLocale(locale);
  const url = pageUrl(lang, `/docs/${section[0]}`);
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: page.title,
      description: page.description ?? SITE_COPY[lang].description,
      url,
      inLanguage: lang === "pt" ? "pt-BR" : "en",
      author: { "@id": `${SITE_URL}/#organization` },
      publisher: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
    },
    breadcrumbList(docsCrumbs(lang, { name: page.title, url })),
    ...(section[0] === "sdks" ? [sdkSourceCode(lang)] : []),
  ];

  return (
    <>
      <JsonLd data={structured} />
      <DocsHeader
        locale={locale}
        slug={section[0]}
        localeSwitch={tree.chrome.localeSwitch}
      />
      <h1 className="text-3xl font-semibold">{page.title}</h1>
      {page.description && (
        <p className="mt-3 max-w-2xl text-text-3">{page.description}</p>
      )}
      <div className="mt-8">
        <DocBlocks blocks={page.blocks} copy={tree.chrome.copy} />
      </div>
    </>
  );
}
