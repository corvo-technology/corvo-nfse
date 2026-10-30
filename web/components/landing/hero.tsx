"use client";

import Link from "next/link";

import { motion, type Variants } from "motion/react";
import { useTranslations, useLocale } from "next-intl";

const stagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

/**
 * Slide only, no opacity fade: the hero text is the LCP element and must be
 * visible in the server HTML, before JavaScript runs.
 */
export const fadeUp: Variants = {
  hidden: { y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

const REQUEST_SAMPLE = `curl -X POST https://api.corvo.tech/v1/invoices \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Idempotency-Key: pedido_123_emissao" \\
  -d '{
    "companyTaxId": "11222333000181",
    "amount": 100,
    "service": { "description": "Consultoria" }
  }'`;

/** The brand mark, drawn large. Same two facets and eye as /logos/corvo-faceted-green.svg, flipped to face the headline. */
function CrowHead({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="14 13 50 37" className={className}>
      <path d="M17 44L21 21L39 16L45 25L20 47Z" fill="#3fd6a8" />
      <path d="M39 16L45 25L61 26L45 30L41 44L20 47Z" fill="#3fd6a8" fillOpacity={0.55} />
      <circle cx="33" cy="24.5" r="2.4" fill="#0a0a0a" />
    </svg>
  );
}

export function Hero() {
  const t = useTranslations("Hero");
  const locale = useLocale();

  return (
    <section className="relative w-full overflow-hidden px-6 sm:px-10 pt-14 sm:pt-20 pb-[calc(5vw+56px)] lg:min-h-[720px]">
      <CrowHead className="pointer-events-none absolute -right-[18%] top-6 w-[78%] -scale-x-100 opacity-90 sm:-right-[8%] sm:w-[58%] lg:right-[-4%] lg:top-1/2 lg:w-[56%] lg:max-w-[820px] lg:-translate-y-[58%]" />

      <div className="relative mx-auto max-w-[1120px]">
        <motion.div
          className="flex max-w-[620px] flex-col items-start pt-[34vw] sm:pt-[22vw] lg:pt-6"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.h1
            variants={fadeUp}
            className="font-semibold text-text leading-[0.98] tracking-[-0.04em] mb-6 text-balance"
            style={{ fontSize: "clamp(40px, 6vw, 84px)" }}
          >
            {t("title")}
          </motion.h1>

          <motion.p variants={fadeUp} className="max-w-[500px] text-[18px] leading-[1.55] text-text-2 text-pretty mb-8">
            {t("subtitle")}
          </motion.p>

          <motion.div variants={fadeUp} className="flex w-full flex-col sm:w-auto sm:flex-row items-center gap-3 mb-5">
            <Link
              href="/login?mode=signup"
              className="inline-flex items-center justify-center bg-accent text-[#06120d] px-5.5 py-3 rounded-[6px] text-[15px] font-semibold transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] w-full sm:w-auto"
            >
              {t("startFree")}
            </Link>
            <a
              href={`/${locale}/docs`}
              className="inline-flex items-center justify-center border border-border-strong px-5.5 py-3 rounded-[6px] text-[15px] text-[#d4d4d4] transition-[background-color,transform] hover:bg-white/[0.04] active:scale-[0.98] w-full sm:w-auto"
            >
              {t("viewDocs")}
            </a>
          </motion.div>

          <motion.p variants={fadeUp} className="font-mono text-xs text-text-4">
            {t("mono")}
          </motion.p>
        </motion.div>

        <div className="mt-12 w-full min-w-0 border border-border bg-[#0b0b0b] lg:absolute lg:bottom-[-24px] lg:right-0 lg:mt-0 lg:w-[440px]">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-xs text-text-4">
            <span>POST /v1/invoices</span>
            <span className="text-accent">202 queued</span>
          </div>
          <pre
            tabIndex={0}
            aria-label="Exemplo de requisição para emitir NFS-e"
            className="overflow-x-auto p-4 font-mono text-[12px] leading-[1.7] text-text-2"
          >
            <code>{REQUEST_SAMPLE}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
