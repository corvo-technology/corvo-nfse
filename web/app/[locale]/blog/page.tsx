import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Rss } from "lucide-react";
import { CtaBand } from "@/components/blog/cta-band";
import { PostCard } from "@/components/blog/post-card";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { JsonLd } from "@/components/seo/json-ld";
import { BLOG_LOCALE, POSTS } from "@/lib/blog/registry";
import { BLOG_DESCRIPTION, BLOG_PATH, BLOG_TITLE, feedUrl, indexStructuredData } from "@/lib/blog/seo";
import { CLUSTER_LABEL } from "@/lib/blog/types";
import { pageMetadata } from "@/lib/seo";

/** Only the Portuguese blog exists. */
export function generateStaticParams() {
  return [{ locale: BLOG_LOCALE }];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== BLOG_LOCALE) return { robots: { index: false } };
  const base = pageMetadata({
    locale,
    path: BLOG_PATH,
    title: BLOG_TITLE,
    absoluteTitle: true,
    description: BLOG_DESCRIPTION,
    onlyLocale: BLOG_LOCALE,
  });
  return { ...base, alternates: { ...base.alternates, types: { "application/rss+xml": feedUrl() } } };
}

export default async function BlogIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== BLOG_LOCALE) notFound();
  setRequestLocale(locale);

  const [featured, ...rest] = POSTS;
  const clusters = [...new Set(POSTS.map((post) => post.cluster))];

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <JsonLd data={indexStructuredData()} />
      <Nav />
      <main id="content" className="mx-auto w-full max-w-[1120px] px-6 pb-24 pt-14 sm:px-10 sm:pt-20">
        <header className="max-w-[760px]">
          <p className="eyebrow !text-accent">Blog</p>
          <h1 className="mt-4 text-[clamp(34px,6vw,60px)] font-semibold leading-[1.02] tracking-[-0.03em] text-balance">
            Nota fiscal de serviço, do ponto de vista de quem integra.
          </h1>
          <p className="mt-5 max-w-[60ch] text-[17px] leading-[1.7] text-text-3">
            Guias práticos para desenvolvedores, SaaS e ERPs que emitem NFS-e de empresas MEI e do Simples Nacional por API:
            integração assíncrona, idempotência, webhooks, agentes de IA (MCP) e cálculo de IBS/CBS.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {clusters.map((cluster) => (
              <span
                key={cluster}
                className="rounded-full border border-border-strong px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-3"
              >
                {CLUSTER_LABEL[cluster]}
              </span>
            ))}
            <Link
              href="/pt/blog/feed.xml"
              className="ml-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-4 transition-colors hover:text-accent"
            >
              <Rss aria-hidden="true" className="size-3.5" />
              RSS
            </Link>
          </div>
        </header>

        <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {featured && <PostCard post={featured} featured />}
          {rest.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </ul>

        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
