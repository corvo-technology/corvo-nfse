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
  -H "Content-Type: application/json" \\
  -d '{
    "companyTaxId": "11222333000181",
    "amount": 100,
    "service": { "description": "Consultoria" }
  }'`;

export function Hero() {
  const t = useTranslations("Hero");
  const locale = useLocale();

  return (
    <section className="w-full px-6 sm:px-10 pt-16 sm:pt-24 pb-14 sm:pb-20">
      <div className="mx-auto grid max-w-[1120px] items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <motion.div
          className="flex min-w-0 flex-col items-start"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.h1
            variants={fadeUp}
            className="font-semibold text-text leading-[1.02] tracking-[-0.04em] mb-5 text-balance"
            style={{ fontSize: "clamp(36px, 5vw, 64px)" }}
          >
            {t("title")}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="max-w-[560px] text-[18px] leading-[1.55] text-text-2 text-pretty mb-8"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="flex w-full flex-col sm:w-auto sm:flex-row items-center gap-3 mb-5"
          >
            <Link
              href="/login?mode=signup"
              className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] px-5.5 py-3 rounded-[8px] text-[15px] font-medium transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] w-full sm:w-auto"
            >
              {t("startFree")}
            </Link>
            <a
              href={`/${locale}/docs`}
              className="inline-flex items-center justify-center border border-border-strong px-5.5 py-3 rounded-[8px] text-[15px] text-[#d4d4d4] transition-[background-color,transform] hover:bg-white/[0.04] active:scale-[0.98] w-full sm:w-auto"
            >
              {t("viewDocs")}
            </a>
          </motion.div>

          <motion.p variants={fadeUp} className="font-mono text-xs text-text-4">
            {t("mono")}
          </motion.p>
        </motion.div>

        <div className="min-w-0 rounded-[10px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-mono text-xs text-text-4">
            <span>POST /v1/invoices</span>
            <span className="text-accent">202 queued</span>
          </div>
          <pre
            tabIndex={0}
            aria-label="Exemplo de requisição para emitir NFS-e"
            className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.7] text-text-2"
          >
            <code>{REQUEST_SAMPLE}</code>
          </pre>
          <p className="border-t border-border px-4 py-2.5 font-mono text-xs text-text-4">
            GET /v1/invoices/:id · nfse.invoice.authorized
          </p>
        </div>
      </div>
    </section>
  );
}
