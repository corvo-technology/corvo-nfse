"use client";

import Link from "next/link";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";

export function FreeTrial() {
  const t = useTranslations("FreeTrial");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22">
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
        className="border border-accent-border rounded-2xl p-8 flex flex-col md:flex-row items-start md:items-center gap-8 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, var(--accent-surface) 0%, var(--bg) 100%)",
        }}
      >
        {/* Animated glow ring */}
        <motion.div
          className="absolute -top-20 -right-20 w-60 h-60 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, var(--accent-surface) 0%, transparent 70%)",
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Left content */}
        <div className="flex-1 relative">
          <span className="font-mono text-xs text-accent tracking-[0.1em]">
            {t("eyebrow")}
          </span>
          <h3 className="text-[30px] font-semibold tracking-[-0.03em] text-text mt-2 leading-tight">
            {t("title")}
          </h3>
          <p className="text-[15.5px] text-text-2 mt-1.5">
            {t("subtitle")}
          </p>
          <p className="text-[15px] text-text-3 mt-2 max-w-[480px] leading-relaxed">
            {t("description")}
          </p>
        </div>

        {/* Right content */}
        <div className="flex flex-col items-start md:items-end gap-3 shrink-0 relative">
          <Link
            href="/login?mode=signup"
            className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] rounded-[8px] px-5.5 py-3 text-[15px] font-medium transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
          >
            {t("startFree")}
          </Link>
          <span className="text-xs text-text-4">
            {t("finePrint")}
          </span>
        </div>
      </motion.div>
    </section>
  );
}
