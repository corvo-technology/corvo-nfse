"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";

const messageTypes = [
  { key: "service", isMarketing: false },
  { key: "utility", isMarketing: false },
  { key: "authentication", isMarketing: false },
  { key: "marketing", isMarketing: true },
];

export function CreditsExplained() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const t = useTranslations("Credits");

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22" ref={ref}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Table card */}
        <div className="border border-border bg-surface rounded-2xl p-7">
          <span className="font-mono text-[11px] text-accent tracking-[0.1em]">
            {t("eyebrow")}
          </span>
          <h3 className="text-[18px] font-semibold text-text mt-2 mb-6">
            {t("title")}
          </h3>

          <div className="w-full">
            <div className="flex items-center pb-3 border-b border-border-soft">
              <span className="flex-1 font-mono text-[10px] text-text-4 tracking-[0.1em] uppercase">
                {t("columnType")}
              </span>
              <span className="w-20 text-center font-mono text-[10px] text-text-4 tracking-[0.1em] uppercase">
                {t("columnCredits")}
              </span>
            </div>
            {messageTypes.map((row, i) => (
              <motion.div
                key={row.key}
                initial={{ opacity: 0, x: -8 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: i * 0.08, duration: 0.4, ease: "easeOut" }}
                className="flex items-center py-3.5 border-b border-border-soft last:border-0"
              >
                <div className="flex-1">
                  <span
                    className={
                      row.isMarketing
                        ? "text-text font-medium text-[14px]"
                        : "text-text text-[14px]"
                    }
                  >
                    {t(`types.${row.key}.name`)}
                  </span>
                  <p className="text-[12.5px] text-text-3 mt-0.5">
                    {t(`types.${row.key}.description`)}
                  </p>
                </div>
                <span
                  className={
                    row.isMarketing
                      ? "w-20 text-center text-accent font-mono text-[14px] font-medium"
                      : "w-20 text-center text-text-2 font-mono text-[14px]"
                  }
                >
                  {t(`types.${row.key}.credits`)}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Example card */}
        <div className="border border-accent-border bg-accent-surface rounded-2xl p-7 flex flex-col justify-center">
          <span className="font-mono text-[11px] text-accent tracking-[0.1em]">
            {t("example")}
          </span>
          <h3 className="text-[18px] font-semibold text-text mt-2 mb-1">
            {t("exampleTitle")}
          </h3>

          <div className="mt-6 space-y-4">
            {/* Utility bar */}
            <div className="border border-accent-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-text">1,000</span>
                <span className="text-[13px] text-text-3">
                  {t("utilityMessages")}
                </span>
              </div>
              <div className="w-full h-[6px] rounded-full bg-bg mt-2.5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={inView ? { width: "100%" } : {}}
                  transition={{ delay: 0.3, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                  className="h-full rounded-full bg-accent"
                />
              </div>
            </div>

            <div className="text-center">
              <span className="text-[12px] text-text-4 font-mono">{t("or")}</span>
            </div>

            {/* Marketing bar */}
            <div className="border border-accent-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-text">100</span>
                <span className="text-[13px] text-text-3">
                  {t("marketingMessages")}
                </span>
              </div>
              <div className="w-full h-[6px] rounded-full bg-bg mt-2.5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={inView ? { width: "10%" } : {}}
                  transition={{ delay: 0.5, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                  className="h-full rounded-full bg-accent"
                />
              </div>
            </div>
          </div>

          <p className="text-[13px] text-text-3 mt-6 leading-relaxed">
            {t("note")}
          </p>
        </div>
      </div>
    </section>
  );
}
