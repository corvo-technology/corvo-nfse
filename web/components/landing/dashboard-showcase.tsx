"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";

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
        initial={{ opacity: 0, y: 30, scale: 0.98 }}
        animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
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
          className="w-full h-auto rounded-2xl border border-border"
          priority
        />
      </motion.div>
    </section>
  );
}
