"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { Building2, Users, Database, Gauge, BarChart3 } from "lucide-react";

const items = [
  { key: "companies", icon: Building2 },
  { key: "perCompany", icon: Users },
  { key: "documents", icon: Database },
  { key: "limits", icon: Gauge },
  { key: "consumption", icon: BarChart3 },
];

export function MultiCompanySection() {
  const t = useTranslations("MultiCompany");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22">
      <div
        ref={ref}
        className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0e0e0e] px-8 sm:px-14 py-14"
      >
        {/* Subtle background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none">
          <div
            className="w-full h-full opacity-10"
            style={{
              background:
                "radial-gradient(ellipse at 50% 0%, rgba(163,230,146,0.4) 0%, transparent 70%)",
            }}
          />
        </div>

        {/* Content */}
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center gap-10">
          {/* Left */}
          <div className="flex-1">
            <span className="font-mono text-[11px] text-accent tracking-[0.12em] uppercase">
              {t("eyebrow")}
            </span>
            <h2 className="text-[34px] font-semibold tracking-[-0.04em] text-text mt-3 leading-tight max-w-[380px]">
              {t("title")}
            </h2>
            <p className="text-[16px] text-text-3 mt-4 max-w-[400px] leading-relaxed">
              {t("description")}
            </p>
          </div>

          {/* Right — features list */}
          <div className="flex flex-col gap-3 min-w-[280px]">
            {items.map((item, i) => (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, x: 16 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{
                  delay: 0.2 + i * 0.08,
                  duration: 0.4,
                  ease: "easeOut",
                }}
                className="flex items-center gap-3"
              >
                <div className="w-7 h-7 rounded-[7px] bg-[#1a1a1a] border border-white/[0.06] flex items-center justify-center shrink-0">
                  <item.icon size={13} className="text-accent" strokeWidth={1.5} />
                </div>
                <span className="text-[13px] text-text-2">{t(`items.${item.key}`)}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
