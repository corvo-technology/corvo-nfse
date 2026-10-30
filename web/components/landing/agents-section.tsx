"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Facet } from "@/components/ui/facet";
import { motion, useInView, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Copy, Mail, ShieldCheck, Sparkles, Unplug } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { MCP_SERVER_URL } from "@/lib/mcp-config";
import { cn } from "@/lib/utils";

const CONNECT_COMMAND = `claude mcp add --transport http corvo ${MCP_SERVER_URL}`;
const AGENTS = ["Claude Code", "Claude Desktop", "Cursor", "VS Code", "Codex", "Windsurf"] as const;
const POINTS = [
  { key: "connect", icon: Unplug },
  { key: "approve", icon: ShieldCheck },
  { key: "rules", icon: Sparkles },
] as const;

/** Delays (s) of the scripted conversation; reduced motion shows everything at once. */
const STEP = { you: 0.2, list: 1.1, issue: 1.9, reply: 2.8, card: 3.4 } as const;
const AUTHORIZED_AFTER_MS = 5600;

function CopyCommand() {
  const t = useTranslations("LandingAgents");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECT_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the command stays selectable on screen.
    }
  };
  return (
    <div className="flex items-start gap-2 rounded-[11px] border border-white/[0.08] bg-[#080808] py-1.5 pl-4 pr-1.5">
      <span aria-hidden className="select-none py-2 font-mono text-[13px] leading-snug text-accent">$</span>
      <code className="min-w-0 flex-1 py-1.5 font-mono text-[12.5px] leading-snug text-text-2">
        claude mcp add --transport http corvo <span className="whitespace-nowrap">{MCP_SERVER_URL}</span>
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-white/[0.08] px-3 py-2 text-[12px] text-text-2 transition-colors hover:bg-white/[0.05] hover:text-text"
      >
        {copied ? <Check size={13} className="text-accent" aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}

function ToolCall({ name, result, delay, show, instant }: { name: string; result: string; delay: number; show: boolean; instant: boolean }) {
  return (
    <motion.div
      initial={instant ? false : { opacity: 0, x: -8 }}
      animate={show ? { opacity: 1, x: 0 } : {}}
      transition={{ delay: instant ? 0 : delay, duration: 0.35, ease: "easeOut" }}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[12px]"
    >
      <span className="grid h-4 w-4 place-items-center rounded-full bg-accent/15 text-accent"><Check size={10} strokeWidth={3} aria-hidden /></span>
      <span className="text-text">{name}</span>
      <span className="text-text-4" aria-hidden>→</span>
      <span className="text-text-3">{result}</span>
    </motion.div>
  );
}

function Conversation() {
  const t = useTranslations("LandingAgents.chat");
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced motion skips the scripted wait
      setAuthorized(true);
      return;
    }
    const timer = setTimeout(() => setAuthorized(true), AUTHORIZED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [inView, reduce]);

  const fade = (delay: number) => ({
    initial: reduce ? (false as const) : { opacity: 0, y: 12 },
    animate: inView ? { opacity: 1, y: 0 } : {},
    transition: { delay: reduce ? 0 : delay, duration: 0.45, ease: "easeOut" as const },
  });

  return (
    <div ref={ref} className="relative overflow-hidden rounded-[8px] border border-border-strong bg-[#0a0a0a]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
        <span className="flex items-center gap-2.5 font-mono text-[11.5px] text-text-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          {t("status")}
        </span>
        <span className="rounded-full border border-white/[0.08] px-2.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-text-3">{t("env")}</span>
      </div>

      <div className="flex min-h-[392px] flex-col gap-5 px-5 py-6 sm:px-6">
        <motion.div {...fade(STEP.you)} className="max-w-[88%] self-end">
          <p className="mb-1.5 text-right font-mono text-[10px] tracking-[0.14em] text-text-4">{t("you")}</p>
          <p className="rounded-2xl rounded-tr-md border border-white/[0.08] bg-white/[0.05] px-4 py-3 text-[14px] leading-relaxed text-text">{t("prompt")}</p>
        </motion.div>

        <div className="flex flex-col gap-3">
          <p className="font-mono text-[10px] tracking-[0.14em] text-text-4">{t("agent")}</p>
          <div className="flex flex-col gap-2.5 border-l border-accent/30 pl-4">
            <ToolCall name="company_list" result={t("listResult")} delay={STEP.list} show={inView} instant={reduce} />
            <ToolCall name="nfse_issue" result={t("issueResult")} delay={STEP.issue} show={inView} instant={reduce} />
          </div>
          <motion.p {...fade(STEP.reply)} className="text-[14px] leading-relaxed text-text-2">{t("reply")}</motion.p>

          <motion.div {...fade(STEP.card)} className="mt-1 flex items-center justify-between gap-4 rounded-[14px] border border-white/[0.08] bg-[#101010] p-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.14em] text-text-4">{t("card.label")}</p>
              <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] tabular-nums text-text">R$ 450,00</p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-text-3">
                <Mail size={12} aria-hidden /> {t("card.detail")}
              </p>
            </div>
            <span
              aria-live="polite"
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] transition-colors duration-500",
                authorized ? "border-accent/40 bg-accent/10 text-accent" : "border-white/[0.1] bg-white/[0.04] text-text-3",
              )}
            >
              {authorized ? t("card.authorized") : t("card.queued")}
            </span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export function AgentsSection() {
  const t = useTranslations("LandingAgents");
  const locale = useLocale();

  return (
    <section id="agents" className="mx-auto max-w-[1120px] border-t border-border px-6 py-16 sm:px-10 sm:py-24">
      <div>
        <div className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="min-w-0 lg:order-2">
            <h2 className="max-w-[460px] text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text text-balance">{t("title")}</h2>
            <p className="mt-5 max-w-[440px] text-[16px] leading-relaxed text-text-3 text-pretty">{t("description")}</p>

            <ul className="mt-7 flex flex-col gap-3.5">
              {POINTS.map(({ key }) => (
                <li key={key} className="flex items-start gap-3.5">
                  <Facet className="mt-[7px]" />
                  <span className="text-[14px] leading-snug text-text-2">{t(`points.${key}`)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-col gap-3">
              <p className="font-mono text-[11px] tracking-[0.1em] text-text-4">{t("connectLabel")}</p>
              <CopyCommand />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <ul className="flex flex-wrap gap-1.5" aria-label={t("agentsLabel")}>
                  {AGENTS.map((name) => (
                    <li key={name} className="rounded-[4px] border border-border-strong px-2.5 py-1 text-[12px] text-text-3">{name}</li>
                  ))}
                </ul>
                <Link href={`/${locale}/docs/mcp`} className="inline-flex items-center gap-1 text-[13px] text-text-2 underline-offset-4 transition-colors hover:text-text hover:underline">
                  {t("docs")} <ArrowUpRight size={13} aria-hidden />
                </Link>
              </div>
            </div>
          </div>

          <Conversation />
        </div>
      </div>
    </section>
  );
}
