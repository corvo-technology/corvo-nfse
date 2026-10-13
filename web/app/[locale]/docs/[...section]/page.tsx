import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DocBlocks } from "@/components/docs/doc-blocks";
import { DocsHeader } from "@/components/docs/docs-header";
import { DOC_SLUGS, getDocsTree } from "@/lib/docs/registry";
import type { DocSlug } from "@/lib/docs/types";

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
  return { title: page ? `${page.title} — Corvo Docs` : "Docs" };
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

  return (
    <>
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
