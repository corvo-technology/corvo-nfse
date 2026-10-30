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
    <section
      id="features"
      className="bg-paper text-ink px-6 sm:px-10 pt-[calc(6vw+48px)] pb-[calc(6vw+48px)] flex flex-col items-center gap-10 [clip-path:polygon(0_6vw,100%_0,100%_calc(100%-6vw),0_100%)]"
    >
      <div className="flex flex-col items-start gap-3 w-full max-w-[1120px]">
        <h2 className="max-w-[640px] text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance">
          {t("title")}
        </h2>
        <p className="max-w-[560px] text-[17px] leading-[1.55] text-ink-2 text-pretty">
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
        <Image
          src="/dash/dashboard-hero-2000x1180.png"
          alt={t("alt")}
          width={2000}
          height={1180}
          // Rendered at most 1120px wide (max-w-[1120px] with px-6/px-10 padding).
          sizes={HERO_IMAGE_SIZES}
          className="w-full h-auto rounded-[8px] shadow-[0_24px_60px_-28px_rgba(13,13,12,0.7)]"
          priority
        />
      </motion.div>
    </section>
  );
}
