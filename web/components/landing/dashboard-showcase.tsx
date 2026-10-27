"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";

export const HERO_IMAGE_SIZES = "(max-width: 640px) calc(100vw - 48px), (max-width: 1200px) calc(100vw - 80px), 1120px";

export function DashboardShowcase() {
  const t = useTranslations("Dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="px-6 sm:px-10 pb-14 sm:pb-22 flex flex-col items-center gap-9">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="font-mono text-xs text-accent tracking-[0.14em]">
          {t("eyebrow")}
        </span>
        <h2 className="text-[34px] font-semibold tracking-[-0.04em] text-wrap-balance">
          {t("title")}
        </h2>
        <p className="max-w-[560px] text-[17px] leading-[1.55] text-text-3 text-pretty">
          {t("description")}
        </p>
      </div>

      <motion.div
        ref={ref}
        // No opacity fade: the screenshot is the LCP element and must paint with the first frame.
        initial={{ y: 30, scale: 0.98 }}
        animate={inView ? { y: 0, scale: 1 } : {}}
        transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-full max-w-[1120px] relative"
      >
        {/* Glow behind image */}
        <div className="absolute inset-0 -z-10 blur-[80px] opacity-20 bg-accent rounded-full scale-90" />
        <Image
          src="/dash/dashboard-hero-2000x1180.png"
          alt={t("alt")}
          width={2000}
          height={1180}
          // Rendered at most 1120px wide (max-w-[1120px] with px-6/px-10 padding).
          sizes={HERO_IMAGE_SIZES}
          className="w-full h-auto rounded-2xl border border-border"
          priority
        />
      </motion.div>
    </section>
  );
}
