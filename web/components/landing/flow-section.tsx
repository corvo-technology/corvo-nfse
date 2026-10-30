"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Facet } from "@/components/ui/facet";

const steps = ["step1", "step2", "step3", "step4"] as const;

export function FlowSection() {
  const t = useTranslations("Flow");
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-16 sm:pb-24">
      <div className="mb-12 max-w-[640px]">
        <h2 className="text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text text-balance">
          {t("title")}
        </h2>
        <p className="mt-5 max-w-[480px] text-[16px] leading-relaxed text-text-3 text-pretty">{t("description")}</p>
      </div>

      <ol ref={ref} className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step} className="relative pt-6">
            <motion.span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[2px] origin-left bg-border-strong"
              initial={reduce ? false : { scaleX: 0 }}
              animate={inView || reduce ? { scaleX: 1 } : { scaleX: 0 }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.span
              aria-hidden
              className="absolute -top-[5px] left-0"
              initial={reduce ? false : { x: -6, opacity: 0 }}
              animate={inView || reduce ? { x: 0, opacity: 1 } : { x: -6, opacity: 0 }}
              transition={{ duration: 0.3, delay: i * 0.12 + 0.1, ease: "easeOut" }}
            >
              <Facet />
            </motion.span>
            <h3 className="text-[16px] font-medium tracking-[-0.01em] text-text">{t(`steps.${step}`)}</h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-text-3 text-pretty">{t(`steps.${step}Desc`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
