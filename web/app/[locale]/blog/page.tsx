import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CtaBand } from "@/components/blog/cta-band";
import { PostRow } from "@/components/blog/post-row";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { JsonLd } from "@/components/seo/json-ld";
import { BLOG_LOCALE, POSTS } from "@/lib/blog/registry";
import { BLOG_DESCRIPTION, BLOG_PATH, BLOG_TITLE, feedUrl, indexStructuredData } from "@/lib/blog/seo";
import { pageMetadata } from "@/lib/seo";

/** The four everyday ways to issue a note, each pointing to its guide. */
const WAYS = [
  {
    title: "Pelo painel",
    body: "Cadastre a empresa, preencha o serviço e o valor. A nota sai com PDF e XML.",
    href: "/pt/blog/como-emitir-nota-fiscal-de-servico-nfse",
  },
  {
    title: "Por planilha",
    body: "Envie um Excel ou CSV, confira as linhas e emita todas de uma vez.",
    href: "/pt/blog/emitir-varias-notas-fiscais-com-planilha",
  },
  {
    title: "Por agenda",
    body: "Para o cliente que paga o mesmo valor todo mês: a nota sai sozinha na data certa.",
    href: "/pt/blog/nota-fiscal-todo-mes-agendada",
  },
  {
    title: "Pedindo a uma IA",
    body: "Conecte o Claude e peça a nota numa conversa. Você confere antes de emitir.",
    href: "/pt/blog/emitir-nota-fiscal-com-claude",
  },
];

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

  const [first, ...rest] = POSTS;

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <JsonLd data={indexStructuredData()} />
      <Nav />
      <main id="content" className="mx-auto w-full max-w-[1120px] px-6 pb-24 pt-14 sm:px-10 sm:pt-20">
        <header className="max-w-[820px]">
          <h1 className="text-[clamp(34px,5.6vw,56px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">
            Como emitir a nota fiscal de serviço da sua empresa.
          </h1>
          <p className="mt-5 max-w-[58ch] text-[17px] leading-[1.7] text-text-3 text-pretty">
            Guias para MEI e empresas do Simples Nacional: o que a nota exige, o que mudou em 2026 e quatro jeitos de emitir.
          </p>
        </header>

        <ul className="mt-14 border-y border-border-soft">
          {first && <PostRow post={first} large />}
          {rest.map((post) => (
            <PostRow key={post.slug} post={post} />
          ))}
        </ul>
        <p className="mt-4 text-[13.5px] text-text-4">
          <Link href="/pt/blog/feed.xml" className="underline decoration-border-strong underline-offset-[3px] hover:text-accent">
            Assinar por RSS
          </Link>
        </p>

        <section aria-labelledby="quem-somos" className="mt-24 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-16">
          <div>
            <h2 id="quem-somos" className="max-w-[16ch] text-[clamp(28px,4vw,38px)] font-semibold leading-[1.1] tracking-[-0.02em] text-balance">
              A Corvo emite a nota de serviço por você.
            </h2>
            <p className="mt-4 max-w-[44ch] text-[16px] leading-[1.7] text-text-3 text-pretty">
              Para MEI e empresas do Simples Nacional. Você cadastra a empresa uma vez e escolhe o jeito que couber no seu dia.
            </p>
          </div>
          <ul className="border-t border-border-soft">
            {WAYS.map((way) => (
              <li key={way.title} className="border-b border-border-soft">
                <Link href={way.href} className="group flex flex-col gap-1 py-5 sm:flex-row sm:gap-8">
                  <span className="shrink-0 text-[17px] font-semibold text-text transition-colors group-hover:text-accent sm:w-40">
                    {way.title}
                  </span>
                  <span className="text-[15.5px] leading-[1.6] text-text-3 text-pretty">{way.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
