"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  Zap,
  FileText,
  Mail,
} from "lucide-react";

const steps = [
  {
    key: "step1",
    descKey: "step1Desc",
    icon: ArrowDown,
  },
  {
    key: "step2",
    descKey: "step2Desc",
    icon: Zap,
  },
  {
    key: "step3",
    descKey: "step3Desc",
    icon: FileText,
  },
  {
    key: "step4",
    descKey: "step4Desc",
    icon: Mail,
  },
];

export function FlowSection() {
  const t = useTranslations("Flow");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22">
      <div className="text-center mb-12">
        <span className="font-mono text-[11px] text-accent tracking-[0.12em] uppercase">
          {t("eyebrow")}
        </span>
        <h2 className="text-[34px] font-semibold tracking-[-0.04em] text-text mt-3">
          {t("title")}
        </h2>
        <p className="text-[16px] text-text-3 mt-3 max-w-[480px] mx-auto">
          {t("description")}
        </p>
      </div>

      <div
        ref={ref}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {steps.map((step, i) => (
          <motion.div
            key={step.key}
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{
              delay: i * 0.12,
              duration: 0.5,
              ease: [0.25, 0.1, 0.25, 1],
            }}
            className="relative rounded-2xl border border-white/[0.06] bg-[#0e0e0e] p-6 flex flex-col gap-4"
          >
            {/* Step number */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-text-4 tracking-[0.1em]">
                0{i + 1}
              </span>
              <div className="w-9 h-9 rounded-[9px] bg-[#111] border border-white/[0.06] flex items-center justify-center">
                <step.icon size={16} className="text-accent" strokeWidth={1.5} />
              </div>
            </div>

            <div>
              <h3 className="text-[14px] font-medium text-text tracking-[-0.01em]">
                {t("steps." + step.key)}
              </h3>
              <p className="text-[13px] text-text-3 mt-1.5 leading-[1.6]">
                {t("steps." + step.descKey)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
