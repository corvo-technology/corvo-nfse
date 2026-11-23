"use client";

import { ArrowUpRight, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Facet } from "@/components/ui/facet";
import { REPO_URL, SELF_HOSTING_URL } from "@/lib/repo";

const POINTS = ["license", "selfHost", "contribute"] as const;

const COMMANDS = [
  `git clone ${REPO_URL}.git`,
  "cd corvo-nfse",
  "node scripts/setup-env.mjs",
  "yarn local:up",
];

export function OpenSourceSection() {
  const t = useTranslations("LandingOpenSource");

  return (
    <section id="open-source" className="mx-auto max-w-[1120px] scroll-mt-20 px-6 py-16 sm:px-10 sm:py-24">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <h2 className="max-w-[520px] text-balance text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text">{t("title")}</h2>
          <p className="mt-5 max-w-[460px] text-[16px] leading-relaxed text-text-3 text-pretty">{t("description")}</p>

          <ul className="mt-7 flex flex-col gap-3.5">
            {POINTS.map((key) => (
              <li key={key} className="flex items-start gap-3.5">
                <Facet className="mt-[7px]" />
                <span className="text-[14px] leading-snug text-text-2">{t(`points.${key}`)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-[6px] bg-accent px-5.5 py-3 text-[15px] font-semibold text-[#06120d] transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
            >
              <Star size={16} aria-hidden /> {t("star")}
            </a>
            <a
              href={SELF_HOSTING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-border-strong px-5.5 py-3 text-[15px] text-[#d4d4d4] transition-[background-color,transform] hover:bg-white/[0.04] active:scale-[0.98]"
            >
              {t("guide")} <ArrowUpRight size={14} aria-hidden />
            </a>
          </div>
          <p className="mt-4 max-w-[420px] text-[13px] leading-relaxed text-text-4">{t("starHint")}</p>
        </div>

        <div className="min-w-0">
          <div className="overflow-hidden rounded-[8px] border border-border-strong bg-[#0a0a0a]">
            <div className="border-b border-border-soft px-4 py-2.5 font-mono text-[12px] text-text-4">{t("codeLabel")}</div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.8] text-text-2" aria-label={t("codeLabel")}>
              {COMMANDS.map((line) => (
                <span key={line} className="block whitespace-pre">
                  <span aria-hidden className="select-none text-text-4">$ </span>
                  {line}
                </span>
              ))}
            </pre>
          </div>
          <p className="mt-3 font-mono text-xs text-text-4">{t("requirements")}</p>
        </div>
      </div>
    </section>
  );
}
