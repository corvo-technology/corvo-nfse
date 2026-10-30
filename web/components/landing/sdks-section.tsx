"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Braces, Check, Copy, ShieldCheck, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SDKS, sdkRepoUrl, type Sdk } from "@/lib/sdks";
import { cn } from "@/lib/utils";

const POINTS = [
  { key: "same", icon: Braces },
  { key: "errors", icon: Undo2 },
  { key: "webhooks", icon: ShieldCheck },
] as const;

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("LandingSdks");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the command stays selectable on screen.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-white/[0.08] px-3 py-2 text-[12px] text-text-2 transition-colors hover:bg-white/[0.05] hover:text-text"
    >
      {copied ? <Check size={13} className="text-accent" aria-hidden /> : <Copy size={13} aria-hidden />}
      {copied ? t("copied") : t("copy")}
    </button>
  );
}

function CodeWindow() {
  const t = useTranslations("LandingSdks");
  const [active, setActive] = useState<Sdk["id"]>("node");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const sdk = SDKS.find((item) => item.id === active) ?? SDKS[0];

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + SDKS.length) % SDKS.length;
    setActive(SDKS[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0a0a0a] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2.5 [scrollbar-width:none]"
      >
        {SDKS.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            role="tab"
            id={`sdk-tab-${item.id}`}
            aria-selected={item.id === active}
            aria-controls="sdk-panel"
            tabIndex={item.id === active ? 0 : -1}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "shrink-0 rounded-[8px] px-3 py-1.5 font-mono text-[12px] transition-colors",
              item.id === active ? "bg-white/[0.08] text-text" : "text-text-3 hover:bg-white/[0.04] hover:text-text-2",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="sdk-panel" aria-labelledby={`sdk-tab-${sdk.id}`} className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-2 rounded-[11px] border border-white/[0.08] bg-[#080808] py-1.5 pl-4 pr-1.5">
          <span aria-hidden className="select-none py-2 font-mono text-[13px] leading-snug text-accent">$</span>
          <code className="min-w-0 flex-1 break-all py-1.5 font-mono text-[12.5px] leading-snug text-text-2">{sdk.install}</code>
          <CopyButton text={sdk.install} />
        </div>

        <pre className="max-h-[360px] overflow-auto rounded-[11px] border border-white/[0.06] bg-[#0d0d0d] p-4 font-mono text-[12.5px] leading-[1.65] text-text-2">
          <code>{sdk.snippet}</code>
        </pre>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12.5px] text-text-3">
          <span>
            <span className="font-mono text-text-2">{sdk.pkg}</span> · {sdk.registry}
          </span>
          <a
            href={sdkRepoUrl(sdk)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-text-2 underline-offset-4 transition-colors hover:text-text hover:underline"
          >
            {t("source")} <ArrowUpRight size={13} aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}

export function SdksSection() {
  const t = useTranslations("LandingSdks");
  const locale = useLocale();

  return (
    <section id="sdks" className="mx-auto max-w-[1120px] px-6 pb-14 sm:px-10 sm:pb-22">
      <div className="relative overflow-hidden rounded-[16px] border border-white/[0.06] bg-[#0e0e0e] px-6 py-12 sm:px-12 sm:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.28]"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            maskImage: "linear-gradient(to bottom left, black, transparent 60%)",
            WebkitMaskImage: "linear-gradient(to bottom left, black, transparent 60%)",
          }}
        />

        <div className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-w-0">
            <h2 className="max-w-[520px] text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] text-text sm:text-[40px]">{t("title")}</h2>
            <p className="mt-4 max-w-[440px] text-[16px] leading-relaxed text-text-3">{t("description")}</p>

            <ul className="mt-7 flex flex-col gap-3.5">
              {POINTS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-white/[0.07] bg-[#161616]">
                    <Icon size={14} className="text-accent" strokeWidth={1.6} aria-hidden />
                  </span>
                  <span className="text-[14px] leading-snug text-text-2">{t(`points.${key}`)}</span>
                </li>
              ))}
            </ul>

            <ul className="mt-8 flex flex-wrap gap-1.5" aria-label={t("languagesLabel")}>
              {SDKS.map((sdk) => (
                <li key={sdk.id} className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[12px] text-text-3">{sdk.name}</li>
              ))}
            </ul>

            <Link href={`/${locale}/docs/sdks`} className="mt-6 inline-flex items-center gap-1 text-[13px] text-text-2 underline-offset-4 transition-colors hover:text-text hover:underline">
              {t("docs")} <ArrowUpRight size={13} aria-hidden />
            </Link>
          </div>

          <CodeWindow />
        </div>
      </div>
    </section>
  );
}
