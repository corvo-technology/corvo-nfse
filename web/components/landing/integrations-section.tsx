"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Check, FileText, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CorvoLogo } from "@/components/ui/corvo-logo";

const PLATFORMS = [
  { id: "woovi", name: "Woovi", logo: "/integrations/woovi.png", width: 800, height: 250 },
  { id: "abacatepay", name: "AbacatePay", logo: "/integrations/abacatepay-white.png", width: 928, height: 384 },
] as const;

const STEPS = ["connect", "webhook", "done"] as const;

/** Dark tiles, like the rest of the page: Woovi's green works as it is and AbacatePay's logo is the white version. */
function PlatformTile({ id, name, logo, width, height }: (typeof PLATFORMS)[number]) {
  const t = useTranslations("LandingIntegrations");
  return (
    <div className="flex h-[92px] flex-col items-center justify-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-[#141414] px-5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-22px_rgba(0,0,0,0.9)]">
      <Image src={logo} alt={name} width={width} height={height} className={id === "woovi" ? "h-[26px] w-auto" : "h-[38px] w-auto"} />
      <p className="text-[11.5px] leading-none text-text-3">{t(`platforms.${id}`)}</p>
    </div>
  );
}

/** A thin dashed line that carries the eye down on narrow screens, where the side-by-side drawing does not fit. */
const DownLine = () => <span aria-hidden className="mx-auto block h-8 w-0 border-l-[1.5px] border-dashed border-accent/60 xl:hidden" />;

/** Two payment platforms feed Corvo, which hands back an invoice. Decorative: the text beside it says the same. */
function FlowVisual() {
  const t = useTranslations("LandingIntegrations");
  return (
    <div className="flex min-w-0 flex-col items-stretch xl:flex-row xl:items-start xl:justify-center">
      <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[192px]">
        {PLATFORMS.map((platform) => (
          <PlatformTile key={platform.id} {...platform} />
        ))}
        <p className="rounded-[12px] border border-dashed border-white/[0.1] px-4 py-3 text-[12.5px] text-text-3">{t("platforms.soon")}</p>
      </div>

      <DownLine />

      <div aria-hidden className="relative hidden h-[200px] w-[60px] shrink-0 xl:block">
        <svg viewBox="0 0 60 200" width="60" height="200" fill="none" className="absolute inset-0 text-accent">
          <path className="flow-path" d="M0 46 C 30 46, 30 100, 60 100" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 6" />
          <path className="flow-path" d="M0 154 C 30 154, 30 100, 60 100" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 6" />
        </svg>
      </div>

      <div aria-hidden className="grid h-[76px] w-[76px] shrink-0 place-items-center self-center rounded-[22px] border border-accent-border bg-accent-surface shadow-[0_0_60px_-14px_rgba(89,224,173,0.45)] xl:mt-[62px] xl:self-start">
        <CorvoLogo size={40} />
      </div>

      <DownLine />

      <div aria-hidden className="relative hidden h-[2px] w-[28px] shrink-0 overflow-hidden xl:mt-[99px] xl:block">
        <span className="flow-line absolute inset-0" />
      </div>

      <div aria-hidden className="w-full shrink-0 rounded-[18px] border border-white/[0.08] bg-[#101010] p-4 shadow-[0_24px_50px_-26px_rgba(0,0,0,0.95)] xl:mt-[22px] xl:w-[180px]">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-text-3"><FileText size={13} aria-hidden /> NFS-e</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-surface px-2 py-0.5 text-[11px] text-accent"><Check size={11} aria-hidden /> {t("invoice.status")}</span>
        </div>
        <p className="mt-4 text-[26px] font-semibold tracking-[-0.03em] text-text">{t("invoice.amount")}</p>
        <p className="mt-0.5 text-[13px] text-text-2">{t("invoice.customer")}</p>
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[12px] text-text-3">{t("invoice.email")}</p>
      </div>
    </div>
  );
}

export function IntegrationsSection() {
  const t = useTranslations("LandingIntegrations");
  const locale = useLocale();

  return (
    <section id="integrations" className="mx-auto max-w-[1120px] scroll-mt-20 px-6 pb-14 sm:px-10 sm:pb-22">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0e0e0e] px-6 py-12 sm:px-12 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute -left-28 -bottom-28 h-[380px] w-[380px] rounded-full bg-accent/[0.06] blur-[100px]" />

        <div className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] lg:gap-14">
          <div className="min-w-0">
            <h2 className="max-w-[480px] text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] text-text sm:text-[40px]">{t("title")}</h2>
            <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed text-text-3">{t("description")}</p>

            <ol className="mt-8 flex flex-col gap-4">
              {STEPS.map((step, index) => (
                <li key={step} className="flex items-start gap-3.5">
                  <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/[0.1] text-[12px] text-text-2">{index + 1}</span>
                  <div>
                    <p className="text-[14.5px] font-medium text-text">{t(`steps.${step}.title`)}</p>
                    <p className="mt-0.5 max-w-[400px] text-[13.5px] leading-snug text-text-3">{t(`steps.${step}.body`)}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex max-w-[460px] items-start gap-3.5 rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
              <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-accent-border bg-accent-surface">
                <Undo2 size={14} className="text-accent" strokeWidth={1.7} aria-hidden />
              </span>
              <div>
                <p className="text-[14.5px] font-medium text-text">{t("refund.title")}</p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-text-3">{t("refund.body")}</p>
              </div>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/login?mode=signup"
                className="inline-flex items-center justify-center rounded-[7px] bg-[#ededec] px-4 py-2 text-[14px] font-medium text-[#0a0a0a] transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:scale-[1.02] hover:opacity-90 active:scale-[0.98]"
              >
                {t("cta")}
              </Link>
              <Link href={`/${locale}/docs/payment-integrations`} className="inline-flex items-center gap-1 text-[13.5px] text-text-2 underline-offset-4 transition-colors hover:text-text hover:underline">
                {t("guide")} <ArrowUpRight size={13} aria-hidden />
              </Link>
            </div>
          </div>

          <FlowVisual />
        </div>
      </div>
    </section>
  );
}
