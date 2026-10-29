"use client";

import { useState } from "react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const nodes = [
  {
    labelKey: "yourApp",
    descKey: "yourAppDesc",
    highlighted: false,
  },
  {
    labelKey: "yourAi",
    descKey: "yourAiDesc",
    highlighted: false,
  },
  {
    labelKey: "whatsappApi",
    descKey: "whatsappApiDesc",
    highlighted: true,
  },
  {
    labelKey: "whatsapp",
    descKey: "whatsappDesc",
    highlighted: false,
  },
];

function ArchDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const t = useTranslations("Architecture");

  return (
    <div ref={ref} className="border border-border bg-surface rounded-2xl p-7 h-full flex flex-col">
      <span className="font-mono text-[11px] text-accent tracking-[0.1em] mb-7">
        {t("eyebrow")}
      </span>

      <div className="flex-1 flex flex-col justify-center gap-0 relative">
        {nodes.map((node, i) => (
          <motion.div
            key={node.labelKey}
            initial={{ opacity: 0, x: -12 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: i * 0.15, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex flex-col"
          >
            <div className="flex items-start gap-4">
              {/* Vertical rail */}
              <div className="flex flex-col items-center">
                {/* Dot */}
                <div className="relative">
                  <div
                    className={cn(
                      "w-[11px] h-[11px] rounded-full shrink-0 mt-[5px] border",
                      node.highlighted
                        ? "bg-accent border-accent"
                        : "bg-[#1a1a1a] border-border-strong"
                    )}
                  />
                  {node.highlighted && (
                    <motion.div
                      className="absolute inset-[-3px] rounded-full bg-accent/20"
                      animate={{ scale: [1, 1.5, 1], opacity: [0.25, 0, 0.25] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                </div>
                {/* Connector line */}
                {i < nodes.length - 1 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={inView ? { scaleY: 1 } : {}}
                    transition={{ delay: i * 0.15 + 0.1, duration: 0.4, ease: "easeOut" }}
                    className="w-[1px] h-8 bg-border-strong origin-top"
                  />
                )}
              </div>

              {/* Text */}
              <div className="pb-6">
                <span
                  className={cn(
                    "text-[14px] font-medium leading-none",
                    node.highlighted ? "text-accent" : "text-text"
                  )}
                >
                  {t(node.labelKey)}
                </span>
                <p className="text-[13px] text-text-3 mt-1.5 leading-[1.5]">
                  {t(node.descKey)}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="text-center text-text-3 text-[13px] mt-6 pt-5 border-t border-border-soft">
        {t("footer")}
      </p>
    </div>
  );
}

const ENV_KEY = "CORVO_API_KEY";
const ENV_VALUE = "<CORVO_API_KEY>";

const codeNode = `await fetch("https://api.corvo.tech/v1/invoices", {
  method: "POST",
  headers: {
    "x-api-key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
    "Idempotency-Key": "order-123-issue",
  },
  body: JSON.stringify({
    companyTaxId: "11222333000181",
    customer: { taxId: "52998224725", name: "Cliente Exemplo" },
    service: { description: "Desenvolvimento de software" },
    competenceDate: "2026-10-09",
    amount: 199.0,
  }),
});`;

const TOKEN = /(\/\/.*$)|("[^"\n]*")|\b(const|await|new)\b|(\b\d+(?:\.\d+)?\b)|(\b(?:fetch|stringify)\b)|(\bprocess\.env\.\w+)/gm;
const TOKEN_CLASS = [
  "text-text-4 italic",
  "text-[#8fd6a0]",
  "text-[#a5b4fc]",
  "text-[#f2b880]",
  "text-text font-semibold",
  "text-text-2",
];

function highlight(code: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    const g = m.findIndex((v, i) => i > 0 && v !== undefined) - 1;
    out.push(
      <span key={idx} className={TOKEN_CLASS[g]}>
        {m[0]}
      </span>
    );
    last = idx + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-text-3 transition-colors hover:bg-white/[0.07] hover:text-text"
    >
      {done ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
          <path d="M10.5 3.5v-.2A1.8 1.8 0 008.7 1.5H3.8a1.8 1.8 0 00-1.8 1.8v4.9a1.8 1.8 0 001.8 1.8h.2" />
        </svg>
      )}
    </button>
  );
}

function CodeSnippet() {
  const t = useTranslations("Architecture");

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-accent/10 blur-[80px]"
      />

      <div className="relative flex flex-1 flex-col gap-5">
        {/* .env */}
        <div>
          <span className="font-mono text-[11px] tracking-[0.06em] text-text-3">.env</span>
          <div className="relative mt-2.5 rounded-xl border border-white/[0.06] bg-[#101010] px-5 py-4 pr-14 font-mono text-[13px] leading-[1.8]">
            <span className="text-text-2">{ENV_KEY}=</span>
            <span className="text-[#8fd6a0]">{ENV_VALUE}</span>
            <CopyButton text={`${ENV_KEY}=${ENV_VALUE}`} label={t("copy")} />
          </div>
        </div>

        {/* invoice.ts */}
        <div className="flex flex-1 flex-col">
          <span className="font-mono text-[11px] tracking-[0.06em] text-text-3">invoice.ts</span>
          <div className="relative mt-2.5 flex-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-[#101010] px-5 py-4 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-border-strong">
            <pre className="w-max min-w-full pr-10 font-mono text-[12.5px] leading-[1.75] text-text-2">
              <code>{highlight(codeNode)}</code>
            </pre>
            <CopyButton text={codeNode} label={t("copy")} />
          </div>
        </div>

        <p className="text-[12.5px] text-text-3">{t("companyDefaults")}</p>

        {/* response */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/[0.06] pt-4">
          <span className="flex items-center gap-2.5 text-[13px] text-text-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
              <span className="relative h-2 w-2 rounded-full bg-accent" />
            </span>
            {t("emitting")} <span className="font-medium text-text">api.corvo.tech</span>
          </span>
          <span className="font-mono text-[11px] text-text-3">
            POST /v1/invoices <span className="text-[#8fd6a0]">202</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function Architecture() {
  return (
    <section className="max-w-[1120px] mx-auto px-10 py-20">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ArchDiagram />
        <CodeSnippet />
      </div>
    </section>
  );
}
