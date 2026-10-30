"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

export function FreeTrial() {
  const t = useTranslations("FreeTrial");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduce = useReducedMotion();
  const title = t("title");
  const [, count, rest] = title.match(/^(\d+)\s+(.*)$/) ?? [null, null, title];

  return (
    <section className="bg-accent text-[#06120d] px-6 sm:px-10 pt-[calc(5vw+40px)] pb-[calc(5vw+40px)] [clip-path:polygon(0_5vw,100%_0,100%_calc(100%-5vw),0_100%)]">
      <div className="mx-auto grid max-w-[1120px] items-center gap-10 md:grid-cols-[auto_1fr] md:gap-16">
        <div ref={ref} className="flex items-end gap-5">
          {count && (
            <span aria-hidden className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className="block text-[clamp(120px,20vw,240px)] font-semibold leading-[0.8] tracking-[-0.04em]"
                initial={reduce ? false : { y: "105%" }}
                animate={inView || reduce ? { y: 0 } : { y: "105%" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                {count}
              </motion.span>
            </span>
          )}
          <h3 className="max-w-[260px] pb-1 text-[clamp(24px,3vw,36px)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">
            {count && <span className="sr-only">{count} </span>}
            {rest}
          </h3>
        </div>

        <div className="flex flex-col items-start gap-5 md:justify-self-end md:max-w-[460px]">
          <p className="text-[16px] font-medium">{t("subtitle")}</p>
          <p className="text-[15.5px] leading-relaxed text-[#06120d]/80 text-pretty">{t("description")}</p>
          <Link
            href="/login?mode=signup"
            className="inline-flex items-center justify-center rounded-[6px] bg-[#06120d] px-5.5 py-3 text-[15px] font-medium text-accent transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
          >
            {t("startFree")}
          </Link>
          <span className="text-xs text-[#06120d]/70">{t("finePrint")}</span>
        </div>
      </div>
    </section>
  );
}
