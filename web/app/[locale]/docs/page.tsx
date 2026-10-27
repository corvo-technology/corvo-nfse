import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DocBlocks } from "@/components/docs/doc-blocks";
import { DocsHeader } from "@/components/docs/docs-header";
import { getDocsTree } from "@/lib/docs/registry";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE_COPY, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const tree = getDocsTree(locale);
  return pageMetadata({
    locale,
    path: "/docs",
    title: seoLocale(locale) === "pt" ? "Documentação da API de NFS-e" : "NFS-e API documentation",
    description: tree?.home.description ?? SITE_COPY[seoLocale(locale)].description,
  });
}

export default async function DocsHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tree = getDocsTree(locale);
  if (!tree) notFound();

  const lang = seoLocale(locale);
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Corvo", item: pageUrl(lang) },
      { "@type": "ListItem", position: 2, name: lang === "pt" ? "Documentação" : "Docs", item: pageUrl(lang, "/docs") },
    ],
  };

  return (
    <>
      <JsonLd data={breadcrumb} />
      <DocsHeader
        locale={locale}
        slug={null}
        localeSwitch={tree.chrome.localeSwitch}
      />
      <h1 className="text-3xl font-semibold">{tree.home.title}</h1>
      {tree.home.description && (
        <p className="mt-3 max-w-2xl text-text-3">{tree.home.description}</p>
      )}
      <div className="mt-8">
        <DocBlocks blocks={tree.home.blocks} copy={tree.chrome.copy} />
      </div>
    </>
  );
}
