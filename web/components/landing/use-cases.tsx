"use client";

import { useRef } from "react";
import {
  useMotionValue,
  useAnimationFrame,
  useTransform,
  motion,
} from "motion/react";
import {
  Layers,
  Building2,
  Code2,
  Briefcase,
} from "lucide-react";
import { useTranslations } from "next-intl";

const cases = [
  {
    icon: Layers,
    titleKey: "saas.title",
    descKey: "saas.description",
  },
  {
    icon: Building2,
    titleKey: "erp.title",
    descKey: "erp.description",
  },
  {
    icon: Code2,
    titleKey: "agencies.title",
    descKey: "agencies.description",
  },
  {
    icon: Briefcase,
    titleKey: "companies.title",
    descKey: "companies.description",
  },
];

/* ── Single card ────────────────────────────────────────────── */

function Card({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ size: number; className: string; strokeWidth: number }>;
  title: string;
  description: string;
}) {
  return (
    <div className="w-[300px] shrink-0 rounded-[16px] border border-white/[0.06] bg-[#0a0a0a] p-6 flex flex-col gap-4 select-none">
      <div className="w-10 h-10 rounded-[10px] bg-[#111] border border-white/[0.06] flex items-center justify-center">
        <Icon size={18} className="text-[#a1a1a1]" strokeWidth={1.5} />
      </div>
      <h3 className="text-[14px] font-medium text-[#ededec] tracking-[-0.01em]">
        {title}
      </h3>
      <p className="text-[13px] text-[#666] leading-[1.6]">
        {description}
      </p>
    </div>
  );
}

/* ── Ticker ─────────────────────────────────────────────────── */

interface TickerProps {
  children: React.ReactNode;
  /** Pixels per second */
  speed?: number;
  className?: string;
}

function Ticker({ children, speed = 30, className }: TickerProps) {
  const x = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useAnimationFrame((_, delta) => {
    const track = trackRef.current;
    if (!track) return;

    const trackWidth = track.scrollWidth / 2;
    if (trackWidth <= 0) return;

    const current = x.get();
    const next = current - (speed * delta) / 1000;
    x.set(next <= -trackWidth ? 0 : next);
  });

  const translateX = useTransform(x, (v) => `${v}px`);

  return (
    <div ref={containerRef} className={className}>
      <motion.div
        ref={trackRef}
        style={{ translateX, willChange: "transform" }}
        className="flex gap-4 w-max"
      >
        {children}
        {children}
      </motion.div>
    </div>
  );
}

/* ── Use cases section ──────────────────────────────────────── */

export function UseCases() {
  const t = useTranslations("UseCases");
  const cards = cases.map((c, i) => (
    <Card
      key={i}
      icon={c.icon}
      title={t(c.titleKey)}
      description={t(c.descKey)}
    />
  ));

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22">
      {/* Header */}
      <div className="mb-12">
        <span className="font-mono text-[11px] text-[#666] tracking-[0.12em] uppercase">
          {t("eyebrow")}
        </span>
        <h2 className="text-[34px] font-semibold tracking-[-0.04em] text-[#ededec] mt-3">
          {t("title")}
        </h2>
        <p className="text-[17px] text-[#666] mt-3 max-w-[520px]">
          {t("description")}
        </p>
      </div>

      {/* Marquee — fades at edges */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-bg to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-bg to-transparent z-10" />

        <div className="overflow-hidden py-2">
          <Ticker speed={28} className="overflow-visible">
            {cards}
          </Ticker>
        </div>
      </div>
    </section>
  );
}
