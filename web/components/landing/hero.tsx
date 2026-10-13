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

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

export function Hero() {
  const t = useTranslations("Hero");
  const locale = useLocale();

  return (
    <section
      className="w-full px-6 sm:px-10 pt-16 sm:pt-24 pb-14 sm:pb-20"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, #131a17 0%, #0a0a0a 62%)",
      }}
    >
      <motion.div
        className="mx-auto max-w-[860px] flex flex-col items-center text-center"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        {/* Badge pill */}
        <motion.div
          variants={fadeUp}
          className="flex items-center gap-2.5 border border-border bg-[#0f0f0f] rounded-full px-3 py-1.5 mb-8"
        >
          <span className="h-[6px] w-[6px] rounded-full bg-accent shrink-0" />
          <span className="font-mono text-xs text-text-3">
            {t("badge")}
          </span>
        </motion.div>

        {/* H1 */}
        <motion.h1
          variants={fadeUp}
          className="font-semibold text-text leading-[1.02] tracking-[-0.04em] mb-5"
          style={{ fontSize: "clamp(36px, 5.5vw, 72px)" }}
        >
          {t("title")}
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={fadeUp}
          className="max-w-[600px] text-[19px] leading-[1.55] text-text-2 text-balance mb-8"
        >
          {t("subtitle")}
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={fadeUp}
          className="flex flex-col sm:flex-row items-center gap-3 mb-6"
        >
          <Link
            href="/login?mode=signup"
            className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] px-5.5 py-3 rounded-[8px] text-[15px] font-medium transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto"
          >
            {t("startFree")}
          </Link>
          <a
            href={`/${locale}/docs`}
            className="inline-flex items-center justify-center border border-border-strong px-5.5 py-3 rounded-[8px] text-[15px] text-[#d4d4d4] transition-all hover:bg-white/[0.04] hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto"
          >
            {t("viewDocs")}
          </a>
        </motion.div>

        {/* Mono line */}
        <motion.p
          variants={fadeUp}
          className="font-mono text-xs text-text-4 pt-1"
        >
          {t("mono")}
        </motion.p>
      </motion.div>
    </section>
  );
}
