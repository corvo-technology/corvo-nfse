import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { JsonLd } from "@/components/seo/json-ld";

/**
 * Building blocks of the public product pages (integrations, NF-e, NFC-e). They reuse the
 * landing's header, footer, tokens and classes: nothing here has a look of its own.
 */

export const PRIMARY_LINK =
  "inline-flex items-center justify-center bg-accent text-[#06120d] px-5.5 py-3 rounded-[6px] text-[15px] font-semibold transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] w-full sm:w-auto";
export const SECONDARY_LINK =
  "inline-flex items-center justify-center border border-border-strong px-5.5 py-3 rounded-[6px] text-[15px] text-[#d4d4d4] transition-[background-color,transform] hover:bg-white/[0.04] active:scale-[0.98] w-full sm:w-auto";

export function MarketingShell({ children, jsonLd }: { children: ReactNode; jsonLd?: Record<string, unknown> }) {
  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

export function PageHero({ eyebrow, title, lead, actions, note, aside }: { eyebrow: string; title: string; lead: string; actions: ReactNode; note?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="px-6 pb-16 pt-14 sm:px-10 sm:pb-24 sm:pt-20">
      <div className={aside ? "mx-auto grid max-w-[1120px] items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14" : "mx-auto max-w-[1120px]"}>
        <div className="flex min-w-0 max-w-[700px] flex-col items-start">
          <p className="mb-4 font-mono text-[12px] uppercase tracking-[0.08em] text-text-3">{eyebrow}</p>
          <h1 className="mb-6 text-balance text-[clamp(38px,6vw,68px)] font-semibold leading-[1] tracking-[-0.04em] text-text">{title}</h1>
          <p className="mb-8 max-w-[560px] text-pretty text-[18px] leading-[1.55] text-text-2">{lead}</p>
          <div className="mb-5 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">{actions}</div>
          {note}
        </div>
        {aside}
      </div>
    </section>
  );
}

/** The honest status line: shown next to the calls to action of the NF-e and NFC-e pages. */
export function StatusNote({ note, detail, tone = "dark" }: { note: string; detail: string; tone?: "dark" | "paper" }) {
  const dark = tone === "dark";
  return (
    <div className={dark ? "max-w-[520px] text-[13.5px] leading-snug text-text-3" : "max-w-[520px] text-[13.5px] leading-snug text-ink-2"}>
      <p className={dark ? "font-medium text-accent" : "font-medium text-ink"}>{note}</p>
      <p className="mt-1">{detail}</p>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-white/[0.08] bg-[#101010] p-6 shadow-[0_24px_50px_-26px_rgba(0,0,0,0.95)]">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text">{title}</h3>
      <p className="text-[14.5px] leading-relaxed text-text-2">{children}</p>
    </div>
  );
}

export function CardSection({ id, title, items }: { id: string; title: string; items: { key: string; title: string; body: string }[] }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-[1120px] px-6 py-16 sm:px-10 sm:py-20">
      <h2 id={id} className="max-w-[640px] text-balance text-[clamp(30px,4vw,48px)] font-semibold leading-[1.04] tracking-[-0.035em] text-text">{title}</h2>
      <div className="mt-10 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.key} title={item.title}>{item.body}</Card>
        ))}
      </div>
    </section>
  );
}

/** The paper band of the landing (diagonal edges), for the part of a page people compare or pick from. */
export function PaperBand({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="bg-paper text-ink px-6 pt-[calc(6vw+48px)] pb-[calc(6vw+48px)] sm:px-10 [clip-path:polygon(0_0,100%_6vw,100%_100%,0_calc(100%-6vw))]">
      <div className="mx-auto max-w-[1120px]">{children}</div>
    </section>
  );
}

const PAPER_PRIMARY_LINK =
  "inline-flex items-center justify-center rounded-[6px] bg-ink px-5.5 py-3 text-[15px] font-semibold text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] w-full sm:w-auto";
const PAPER_SECONDARY_LINK =
  "inline-flex items-center justify-center rounded-[6px] border border-ink/30 px-5.5 py-3 text-[15px] font-medium text-ink transition-[background-color,transform] hover:bg-ink/[0.05] active:scale-[0.98] w-full sm:w-auto";

export function CtaLink({ href, children, variant, tone = "dark" }: { href: string; children: ReactNode; variant: "primary" | "secondary"; tone?: "dark" | "paper" }) {
  const classes = tone === "paper" ? (variant === "primary" ? PAPER_PRIMARY_LINK : PAPER_SECONDARY_LINK) : variant === "primary" ? PRIMARY_LINK : SECONDARY_LINK;
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
