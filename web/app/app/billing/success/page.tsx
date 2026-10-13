"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowRight, RotateCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { billing } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type State = "pending" | "done" | "failed" | "missing";

const POLL_MS = 3000;
const MAX_TRIES = 10;

/* ── Seal: spinning arc while waiting, drawn check once active ── */

function Seal({ state }: { state: State }) {
  const reduce = useReducedMotion();
  const done = state === "done";
  const failed = state === "failed" || state === "missing";
  const tone = failed ? "var(--warn)" : "var(--accent)";

  return (
    <div className="relative grid h-[104px] w-[104px] place-items-center" aria-hidden>
      {done && !reduce && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ border: "1px solid var(--accent)" }}
            initial={{ scale: 0.7, opacity: 0.7 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 1.3, ease: "easeOut" }}
          />
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ border: "1px solid var(--accent)" }}
            initial={{ scale: 0.7, opacity: 0.5 }}
            animate={{ scale: 1.45, opacity: 0 }}
            transition={{ duration: 1.1, delay: 0.15, ease: "easeOut" }}
          />
        </>
      )}
      <span
        className="absolute inset-0 rounded-full blur-2xl transition-opacity duration-700"
        style={{ background: tone, opacity: done ? 0.22 : failed ? 0.1 : 0.08 }}
      />
      {state === "pending" && (
        <>
          {/* sweep: the whole <svg> spins around its exact center */}
          <svg viewBox="0 0 104 104" className="absolute inset-0 z-10 h-full w-full animate-spin motion-reduce:animate-none" style={{ animationDuration: "1.5s", animationTimingFunction: "cubic-bezier(0.5, 0.1, 0.5, 0.9)" }}>
            <defs>
              <linearGradient id="seal-sweep" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="1" />
              </linearGradient>
            </defs>
            <circle cx="52" cy="52" r="46" fill="none" stroke="url(#seal-sweep)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="150 289" transform="rotate(-90 52 52)" />
          </svg>
          {/* core: breathing dot with a soft ring */}
          <span className="absolute left-1/2 top-1/2 z-10 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2">
            <span className="absolute inset-0 rounded-full bg-accent/30 motion-safe:animate-ping" style={{ animationDuration: "1.8s" }} />
            <span className="absolute inset-[5px] rounded-full bg-accent" />
          </span>
        </>
      )}
      <svg viewBox="0 0 104 104" className="relative h-full w-full">
        <circle cx="52" cy="52" r="46" fill="none" stroke="var(--border-strong)" strokeWidth="1" />
        <circle cx="52" cy="52" r="38" fill="var(--accent-surface)" stroke="var(--border)" strokeWidth="1" />
        {done && (
          <>
            <g transform="rotate(-90 52 52)">
              <motion.circle
                cx="52" cy="52" r="46" fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round"
                initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              />
            </g>
            <motion.path
              d="M36 53.5l11.5 11L69 40" fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
              initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: reduce ? 0 : 0.5, ease: "easeOut" }}
            />
          </>
        )}
        {failed && (
          <g stroke={tone} strokeWidth="4" strokeLinecap="round">
            <path d="M52 36v20" />
            <path d="M52 67.5v.5" />
          </g>
        )}
      </svg>
    </div>
  );
}

/* ── Timeline: paid → confirming → active ── */

function Steps({ state }: { state: State }) {
  const t = useTranslations("Billing.success");
  const done = state === "done";
  const steps = [
    { key: "paid", complete: true, active: false },
    { key: "confirming", complete: done, active: state === "pending" },
    { key: "active", complete: done, active: false },
  ] as const;

  return (
    <ol className="relative flex flex-col gap-5">
      <span aria-hidden className="absolute bottom-3 left-[8px] top-3 w-px bg-border-strong" />
      <motion.span
        aria-hidden
        className="absolute left-[8px] top-3 w-px origin-top bg-accent"
        style={{ height: "calc(100% - 24px)" }}
        initial={false}
        animate={{ scaleY: done ? 1 : 0.5 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
      {steps.map((step) => (
        <li key={step.key} className="relative flex items-center gap-4">
          <span
            className={cn(
              "relative z-10 grid h-[17px] w-[17px] place-items-center rounded-full border transition-colors duration-500",
              step.complete ? "border-accent bg-accent" : step.active ? "border-accent bg-bg" : "border-border-strong bg-bg"
            )}
          >
            {step.complete && (
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-[#06110d]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.4l2.4 2.3 4.6-5" /></svg>
            )}
            {step.active && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="absolute inset-[-5px] animate-ping rounded-full border border-accent/50 motion-reduce:animate-none" />
              </>
            )}
          </span>
          <span className={cn("text-[14px] transition-colors duration-500", step.complete || step.active ? "text-text" : "text-text-4")}>
            {t(`steps.${step.key}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ── Receipt summary ── */

function Summary({ plan }: { plan: BillingPlan | null }) {
  const t = useTranslations("Billing.success");
  const tp = useTranslations("Pricing");
  const locale = useLocale();
  const intl = locale === "pt" ? "pt-BR" : "en-US";
  const known = plan && ["free", "developer", "growth", "scale", "volume"].includes(plan.slug);
  const rows: [string, string][] = plan
    ? [
        [t("summary.plan"), known ? tp(`plans.${plan.slug}.name`) : plan.name],
        [t("summary.allowance"), new Intl.NumberFormat(intl).format(plan.usage.monthlyAllowance)],
        [t("summary.price"), new Intl.NumberFormat(intl, { style: "currency", currency: "BRL" }).format(plan.monthlyPriceCents / 100)],
        [t("summary.renews"), plan.subscription.paidUntil ? new Date(plan.subscription.paidUntil).toLocaleDateString(intl, { day: "2-digit", month: "long", year: "numeric" }) : "—"],
      ]
    : [];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
      {rows.length === 0
        ? Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <span className="h-2.5 w-14 animate-pulse rounded bg-track motion-reduce:animate-none" />
              <span className="h-4 w-24 animate-pulse rounded bg-track motion-reduce:animate-none" />
            </div>
          ))
        : rows.map(([label, value], i) => (
            <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, duration: 0.4 }}>
              <dt className="eyebrow mb-1.5">{label}</dt>
              <dd className="font-mono text-[15px] text-text tabular-nums">{value}</dd>
            </motion.div>
          ))}
    </dl>
  );
}

/* ── Page ── */

function Confirmation() {
  const t = useTranslations("Billing.success");
  const sessionId = useSearchParams().get("session_id");
  const [state, setState] = useState<State>(sessionId ? "pending" : "missing");
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [round, setRound] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false; let attempts = 0;
    // Stripe confirms through a webhook, so poll until the backend reports `activated`.
    const check = async () => {
      try {
        const result = await billing.checkoutStatus(sessionId);
        if (cancelled) return;
        if (result.activated) {
          setPlan(await billing.plan().catch(() => null));
          if (!cancelled) setState("done");
          return;
        }
      } catch { if (cancelled) return; }
      if (++attempts >= MAX_TRIES) return setState("failed");
      timer.current = setTimeout(check, POLL_MS);
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [sessionId, round]);

  const retry = useCallback(() => { setState("pending"); setRound((n) => n + 1); }, []);
  const failed = state === "failed" || state === "missing";
  const headline = state === "done" ? "headingDone" : failed ? (state === "missing" ? "headingMissing" : "headingFailed") : "headingPending";
  const body = state === "done" ? "bodyDone" : failed ? (state === "missing" ? "bodyMissing" : "bodyFailed") : "bodyPending";

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <motion.article
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[20px] border border-border-strong bg-surface"
        aria-live="polite"
      >
        {/* atmosphere */}
        <div aria-hidden className={cn("pointer-events-none absolute -top-28 left-1/2 h-64 w-[26rem] -translate-x-1/2 rounded-full blur-[90px] transition-colors duration-700", failed ? "bg-warn/10" : "bg-accent/15")} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "18px 18px", maskImage: "linear-gradient(to bottom, black, transparent 55%)", WebkitMaskImage: "linear-gradient(to bottom, black, transparent 55%)" }}
        />

        <div className="relative flex flex-col items-center px-6 pb-9 pt-10 text-center sm:px-10">
          <Seal state={state} />
          <p className={cn("eyebrow mt-7", failed ? "text-warn" : "text-accent")}>{t("eyebrow")}</p>
          <h1 className="mt-3 text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] text-text sm:text-[32px]">{t(headline)}</h1>
          <p className="mt-3 max-w-[40ch] text-pretty text-[14.5px] leading-relaxed text-text-3">{t(body)}</p>
        </div>

        {/* perforation */}
        <div aria-hidden className="relative h-px">
          <span className="absolute inset-x-6 top-0 border-t border-dashed border-border-strong" />
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border border-border-strong bg-bg" />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full border border-border-strong bg-bg" />
        </div>

        <div className="relative px-6 pb-8 pt-9 sm:px-10">
          {state === "done" ? <Summary plan={plan} /> : state === "missing" ? null : <Steps state={state} />}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {state === "done" && (
              <>
                <Link href="/app/invoices/new" className="btn btn-accent min-h-11 flex-1 justify-center gap-2">
                  {t("ctaIssue")} <ArrowRight size={16} aria-hidden />
                </Link>
                <Link href="/app/billing" className="btn btn-secondary min-h-11 flex-1 justify-center">{t("back")}</Link>
              </>
            )}
            {state === "pending" && (
              <p className="flex items-center justify-center gap-2 text-[12.5px] text-text-4 sm:justify-start">
                <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" /> {t("hint")}
              </p>
            )}
            {failed && (
              <>
                {state === "failed" && <Button variant="accent" size="lg" onClick={retry} className="flex-1"><RotateCw size={15} aria-hidden /> {t("retry")}</Button>}
                <Link href="/app/billing" className="btn btn-secondary min-h-11 flex-1 justify-center">{t("back")}</Link>
              </>
            )}
          </div>
        </div>
      </motion.article>
      {failed && state === "failed" && (
        <p className="mt-4 flex items-start justify-center gap-2 text-center text-[12.5px] text-text-4"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />{t("failedNote")}</p>
      )}
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <div className="py-4 sm:py-10">
      <Suspense fallback={null}><Confirmation /></Suspense>
    </div>
  );
}
