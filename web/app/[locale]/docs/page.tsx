import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DocBlocks } from "@/components/docs/doc-blocks";
import { DocsHeader } from "@/components/docs/docs-header";
import { getDocsTree } from "@/lib/docs/registry";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const tree = getDocsTree(locale);
  return { title: tree ? `${tree.home.title} — Corvo Docs` : "Docs" };
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

  return (
    <>
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
