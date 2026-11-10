import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AnswerBox } from "@/components/blog/answer-box";
import { CtaBand } from "@/components/blog/cta-band";
import { PostBody } from "@/components/blog/post-body";
import { PostRow } from "@/components/blog/post-row";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { JsonLd } from "@/components/seo/json-ld";
import { Inline, NoBreakTerms } from "@/lib/blog/inline";
import {
  BLOG_LOCALE,
  FAQ_ANCHOR,
  POST_SLUGS,
  formatDate,
  getPost,
  readingMinutes,
  relatedPosts,
  tableOfContents,
} from "@/lib/blog/registry";
import { postPath, postStructuredData } from "@/lib/blog/seo";
import { CLUSTER_LABEL } from "@/lib/blog/types";
import { pageMetadata } from "@/lib/seo";

/** Only the Portuguese blog exists. */
export function generateStaticParams() {
  return POST_SLUGS.map((slug) => ({ locale: BLOG_LOCALE, slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = getPost(slug);
  if (!post || locale !== BLOG_LOCALE) return { title: "Blog", robots: { index: false } };
  const base = pageMetadata({
    locale,
    path: postPath(post.slug),
    title: post.seoTitle,
    description: post.description,
    keywords: post.keywords,
    type: "article",
    onlyLocale: BLOG_LOCALE,
  });
  return {
    ...base,
    authors: [{ name: "Corvo" }],
    robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    openGraph: {
      ...base.openGraph,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      section: CLUSTER_LABEL[post.cluster],
      tags: post.keywords,
    } as Metadata["openGraph"],
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const post = getPost(slug);
  if (!post || locale !== BLOG_LOCALE) notFound();
  setRequestLocale(locale);

  const toc = tableOfContents(post);
  const related = relatedPosts(post);
  const updated = post.updatedAt !== post.publishedAt;

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <JsonLd data={postStructuredData(post)} />
      <Nav />
      <main id="content" className="mx-auto w-full max-w-[1120px] px-6 pb-24 pt-10 sm:px-10 sm:pt-14">
        <nav aria-label="Você está em" className="text-[13px] text-text-4">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/pt" className="transition-colors hover:text-text-2">
                Corvo
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/pt/blog" className="transition-colors hover:text-text-2">
                Blog
              </Link>
            </li>
          </ol>
        </nav>

        <article className="mt-8 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,720px)_minmax(0,1fr)] lg:gap-x-16 lg:gap-y-0">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <header>
              <h1 className="text-[clamp(30px,5.4vw,50px)] font-semibold leading-[1.06] tracking-[-0.03em] text-balance">
                <NoBreakTerms text={post.title} />
              </h1>
              <p className="mt-5 text-[14px] leading-[1.7] text-text-4">
                {CLUSTER_LABEL[post.cluster]} · {readingMinutes(post)} min de leitura · Publicado em <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                {updated && (
                  <>
                    {" "}
                    · Atualizado em <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time>
                  </>
                )}
              </p>
            </header>

            <AnswerBox text={post.answer} />
          </div>

          {/* Mobile: title, answer, contents, body. Desktop: contents sit in a sticky right column. */}
          <nav
            aria-label="Neste artigo"
            className="rounded-lg border border-border-soft bg-surface px-5 py-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start lg:border-0 lg:bg-transparent lg:px-0 lg:py-0"
          >
            <p className="text-[13px] font-semibold text-text-2">Neste artigo</p>
            <ul className="mt-3 space-y-2 border-l border-border-soft pl-4 text-[14px] leading-[1.45]">
              {toc.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`} className="text-text-3 transition-colors hover:text-text">
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <div className="mt-2 lg:mt-12">
              <PostBody blocks={post.blocks} />
            </div>

            {post.faq.length > 0 && (
              <section aria-labelledby={FAQ_ANCHOR} className="mt-16">
                <h2
                  id={FAQ_ANCHOR}
                  className="scroll-mt-24 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[30px]"
                >
                  Perguntas frequentes
                </h2>
                <div className="mt-6 divide-y divide-border-soft border-y border-border-soft">
                  {post.faq.map((item) => (
                    <div key={item.q} className="py-5">
                      <h3 className="text-[18px] font-semibold leading-[1.35] tracking-[-0.01em] text-text">{item.q}</h3>
                      <p className="mt-2 text-[16px] leading-[1.7] text-text-2">
                        <Inline text={item.a} />
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </article>

        <CtaBand />

        <section aria-labelledby="leia-tambem" className="mt-20">
          <h2 id="leia-tambem" className="text-[22px] font-semibold tracking-[-0.02em]">
            Leia também
          </h2>
          <ul className="mt-4 border-y border-border-soft">
            {related.map((item) => (
              <PostRow key={item.slug} post={item} headingLevel="h3" />
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  );
}
