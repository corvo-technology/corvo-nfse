"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { PLANS, type PlanSlug, type PlanTier } from "@/lib/plans-catalog";

export { PLANS, type PlanSlug, type PlanTier };

/* ── Pricing engine (mirrors backend PricingService) ─────────── */

const MIN_VOLUME = 1;
const MAX_VOLUME = 50000;
/** Starts exactly at the Essencial allowance, so the first price shown has no overage. */
const DEFAULT_VOLUME = 250;
const THUMB = 22;

export function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/** Overage price per extra invoice, in the locale's decimal format ("R$ 0,12" / "R$ 0.12"). */
export function formatOverage(cents: number, locale: string): string {
  const reais = (cents / 100).toFixed(2);
  return `R$ ${locale === "pt" ? reais.replace(".", ",") : reais}`;
}

/** Cost of a single note: a fraction of a cent matters here, so keep four decimals below R$ 1. */
export function formatBRLPerNote(cents: number): string {
  const reais = cents / 100;
  return `R$ ${reais.toFixed(reais >= 1 ? 2 : 4).replace(".", ",")}`;
}

/** Boundary label: exact below 1.000, otherwise two significant figures ("2,1K", "10K"). */
function limitLabel(n: number, locale: string): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  return `${k.toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { maximumFractionDigits: 1 })}K`;
}

export function calcMonthlyTotal(volume: number, plan: PlanTier): number {
  if (plan.slug === "free") return 0;
  return plan.basePriceCents + Math.max(0, volume - plan.credits) * plan.perCreditCents;
}

/** Free while it fits; otherwise recommend the lowest monthly cost. */
export function findPlanForVolume(volume: number): PlanTier {
  if (volume <= PLANS[0].credits) return PLANS[0];
  return PLANS.slice(1).reduce((best, p) =>
    calcMonthlyTotal(volume, p) < calcMonthlyTotal(volume, best) ? p : best
  );
}

/* Slider position (0–1000) ↔ volume, log scale so 15 and 50.000 are both easy to reach. */
const LOG_MAX = Math.log(MAX_VOLUME / MIN_VOLUME);

function posToVolume(pos: number): number {
  const raw = MIN_VOLUME * Math.exp((pos / 1000) * LOG_MAX);
  const step = raw > 10000 ? 500 : raw > 2000 ? 50 : raw > 200 ? 10 : raw > 50 ? 5 : 1;
  return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, Math.round(raw / step) * step));
}

function volumeToPos(volume: number): number {
  return (Math.log(Math.max(volume, MIN_VOLUME) / MIN_VOLUME) / LOG_MAX) * 1000;
}

/** First volume where each plan becomes the recommendation — drives the colored zones on the track. */
const ZONES = (() => {
  const starts: { plan: PlanTier; from: number }[] = [];
  for (let v = MIN_VOLUME; v <= MAX_VOLUME; v++) {
    const p = findPlanForVolume(v);
    if (starts.length === 0 || starts[starts.length - 1].plan.slug !== p.slug) {
      starts.push({ plan: p, from: v });
    }
  }
  return starts.map((z, i) => ({
    ...z,
    startPos: volumeToPos(z.from) / 1000,
    endPos: i + 1 < starts.length ? volumeToPos(starts[i + 1].from) / 1000 : 1,
  }));
})();

/** Plans with a highlight badge (Pedro's call: Growth is the flagship, Developer the best value). */
export const BADGED_PLANS: ReadonlySet<PlanSlug> = new Set(["growth", "developer"]);
/** The plan whose card gets the highlight border. */
export const HIGHLIGHTED_PLAN: PlanSlug = "growth";

function PlanBadge({ slug, className }: { slug: PlanSlug; className?: string }) {
  const t = useTranslations("Pricing");
  if (!BADGED_PLANS.has(slug)) return null;
  return (
    <span
      data-testid={`plan-badge-${slug}`}
      className={cn(
        "whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em]",
        slug === HIGHLIGHTED_PLAN ? "border-accent/60 text-accent" : "border-white/20 text-text-2",
        className
      )}
    >
      {t(`plans.${slug}.badge`)}
    </span>
  );
}

const thumbOffset = (p: number) => `calc(${p * 100}% + ${(0.5 - p) * THUMB}px)`;

/* ── Animated money ─────────────────────────────────────────── */

function AnimatedBRL({ cents }: { cents: number }) {
  const mv = useMotionValue(cents);
  const text = useTransform(mv, (v) => formatBRL(Math.round(v)));

  useEffect(() => {
    const controls = animate(mv, cents, { duration: 0.45, ease: "easeOut" });
    return () => controls.stop();
  }, [cents, mv]);

  return <motion.span>{text}</motion.span>;
}

/* ── Featured plan (the answer to the slider) ───────────────── */

function FeaturedPlan({
  plan,
  volume,
  current,
  action,
}: {
  plan: PlanTier;
  volume: number;
  current: boolean;
  action: ReactNode;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");

  const isFree = plan.slug === "free";
  const total = calcMonthlyTotal(volume, plan);
  const base = plan.basePriceCents;
  const extraCents = Math.max(0, total - base);
  const extraNotes = Math.max(0, volume - plan.credits);
  const basePct = total > 0 ? (base / total) * 100 : 100;
  const perNote = total / volume;

  const includes = (
    isFree
      ? ["nfse", "dailyLimit", "email", "mcp", "webhooks", "downloads"]
      : ["nfse", "companies", "email", "mcp", "webhooks", "downloads"]
  ) as string[];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-accent/40 bg-accent-surface p-6 @lg:p-9">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-24 h-72 w-72 rounded-full bg-accent/20 blur-[90px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage: "linear-gradient(to bottom, black, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="whitespace-nowrap font-mono text-[12px] tracking-[0.14em] text-text">
              {t(`plans.${plan.slug}.name`)}
            </span>
            <PlanBadge slug={plan.slug} />
            {/* Developer already carries "Melhor custo-benefício"; no second "Recomendado" pill. */}
            {(current || plan.slug !== "developer") && (
              <span className="shrink-0 whitespace-nowrap bg-accent text-[#0a0a0a] font-mono text-[10px] font-semibold tracking-[0.08em] px-2.5 py-1 rounded-full">
                {current ? t("currentPlan") : t("recommended")}
              </span>
            )}
          </div>
          <span className="hidden text-right text-[13px] text-text-3 @5xl:block">
            {t(`plans.${plan.slug}.bestFor`)}
          </span>
        </div>

        {/* Price */}
        <div className="mt-8 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="text-[48px] @lg:text-[64px] @5xl:text-[76px] font-semibold tracking-[-0.05em] leading-[0.9] text-text tabular-nums">
            {isFree ? t("plans.free.price") : <AnimatedBRL cents={total} />}
          </span>
          {!isFree && (
            <span className="text-[15px] text-text-3 mb-2">
              {t("perMonth")}
            </span>
          )}
        </div>

        {/* Effective cost */}
        <p className="mt-3 text-[14px] text-text-2 tabular-nums">
          {isFree
            ? t("breakdown.free")
            : `${t("effective")} `}
          {!isFree && (
            <span className="text-text font-medium">
              {formatBRLPerNote(perNote)} {t("perNoteShort")}
            </span>
          )}
        </p>

        {!isFree && (
          <p data-testid="plan-overage" className="mt-1 text-[13px] text-text-3 tabular-nums">
            {t("overagePerNote", { price: formatOverage(plan.perCreditCents, locale) })}
          </p>
        )}

        {/* Quota vs overage bar */}
        {!isFree && (
          <div className="mt-7">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full bg-accent"
                animate={{ width: `${basePct}%` }}
                transition={{ type: "spring", stiffness: 220, damping: 30 }}
              />
              <motion.div
                className="h-full bg-white/40"
                animate={{ width: `${100 - basePct}%` }}
                transition={{ type: "spring", stiffness: 220, damping: 30 }}
              />
            </div>
            <div className="mt-2.5 flex justify-between text-[12px] tabular-nums">
              <span className="flex items-center gap-2 text-text-2">
                <i className="h-2 w-2 rounded-full bg-accent" />
                {t("breakdown.plan")} · {nf.format(plan.credits)} {t("breakdown.notes")}
                <span className="text-text">{formatBRL(base)}</span>
              </span>
              {extraNotes > 0 && (
                <span className="flex items-center gap-2 text-text-2">
                  <i className="h-2 w-2 rounded-full bg-white/40" />
                  +{nf.format(extraNotes)} {t("breakdown.extra")}
                  <span className="text-text">{formatBRL(extraCents)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="my-8 h-px bg-white/[0.08]" />

        <ul className="grid gap-x-8 gap-y-3 @xl:grid-cols-2">
          {includes.map((key) => (
            <li key={key} className="flex items-start gap-2.5 text-[14px] text-text-2">
              <svg
                viewBox="0 0 16 16"
                className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
              {t(`plans.${plan.slug}.includes.${key}`)}
            </li>
          ))}
        </ul>

        <div className="mt-9">{action}</div>
      </div>
    </div>
  );
}

/* ── Plan ladder (all plans at this volume) ─────────────────── */

function PlanLadder({
  active,
  current,
  volume,
  onPick,
}: {
  active: PlanSlug;
  current?: PlanSlug;
  volume: number;
  onPick: (volume: number) => void;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");

  return (
    <div className="flex flex-col rounded-3xl border border-white/[0.07] bg-[#0b0b0b] p-3">
      <span className="px-4 pt-3 pb-2 font-mono text-[10px] tracking-[0.14em] text-text-4 uppercase">
        {t("allPlans")}
      </span>
      <div className="flex flex-col">
        {PLANS.map((p) => {
          const isActive = p.slug === active;
          const isFree = p.slug === "free";
          const overCap = isFree && volume > p.credits;
          const price = calcMonthlyTotal(volume, p);

          return (
            <button
              key={p.slug}
              type="button"
              data-plan={p.slug}
              onClick={() => onPick(p.credits)}
              className={cn(
                "relative flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03]",
                p.slug === HIGHLIGHTED_PLAN && "border border-accent/30"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="ladder-active"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-2xl border border-accent/40 bg-accent/[0.07]"
                />
              )}
              <span className="relative flex items-center gap-3">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors",
                    isActive ? "bg-accent" : "bg-white/15"
                  )}
                />
                <span>
                  <span
                    className={cn(
                      "block font-mono text-[12px] tracking-[0.1em]",
                      isActive ? "text-text" : "text-text-3"
                    )}
                  >
                    {t(`plans.${p.slug}.name`)}
                    {p.slug === current && <span className="ml-2 text-accent">· {t("currentPlan")}</span>}
                    <PlanBadge slug={p.slug} className="ml-2 align-middle" />
                  </span>
                  <span className="block text-[12px] text-text-4 tabular-nums mt-0.5">
                    {nf.format(p.credits)} {t("credits")}
                  </span>
                  {!isFree && (
                    <span data-testid="plan-overage" className="block text-[11px] text-text-4 tabular-nums">
                      {t("overagePerNote", { price: formatOverage(p.perCreditCents, locale) })}
                    </span>
                  )}
                </span>
              </span>
              <span
                className={cn(
                  "relative text-right text-[15px] font-medium tabular-nums",
                  overCap ? "max-w-[9rem] text-[13px] leading-snug" : "whitespace-nowrap",
                  isActive ? "text-text" : overCap ? "text-text-4" : "text-text-2"
                )}
              >
                {isFree ? (overCap ? t("breakdown.capped", { max: nf.format(p.credits) }) : t("plans.free.price")) : formatBRL(price)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Plan picker: volume slider + recommended plan + ladder ─── */

export interface PickerActionContext {
  plan: PlanTier;
  volume: number;
  isCurrent: boolean;
}

export function PlanPicker({
  currentSlug,
  renderAction,
}: {
  /** Plan the account is on today; the slider starts where this plan is recommended. */
  currentSlug?: PlanSlug;
  renderAction: (ctx: PickerActionContext) => ReactNode;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");

  const startVolume = currentSlug ? (PLANS.find((p) => p.slug === currentSlug)?.credits ?? DEFAULT_VOLUME) : DEFAULT_VOLUME;
  const [volume, setVolume] = useState(startVolume);
  const [draft, setDraft] = useState<string | null>(null);

  const plan = findPlanForVolume(volume);
  const pos = volumeToPos(volume);
  const pct = pos / 10;
  const shown = draft ?? nf.format(volume);

  function commitDraft() {
    const v = parseInt(draft ?? "", 10);
    if (!isNaN(v)) setVolume(Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, v)));
    setDraft(null);
  }

  return (
    <div className="@container">
      {/* Volume slider */}
      <div className="max-w-[820px] mx-auto">
        <p className="text-center font-mono text-[11px] tracking-[0.16em] text-text-3 uppercase">
          {t("slider.label")}
        </p>

        <div className="mt-4 flex items-baseline justify-center gap-3">
          <input
            type="text"
            inputMode="numeric"
            aria-label={t("slider.label")}
            value={shown}
            onFocus={(e) => {
              setDraft(String(volume));
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
            onBlur={commitDraft}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            style={{ width: `${Math.max(2, shown.length + 0.5)}ch` }}
            className="bg-transparent text-center text-[56px] font-semibold tracking-[-0.045em] text-text tabular-nums leading-none focus:outline-none border-b border-dashed border-white/15 focus:border-accent transition-colors"
          />
          <span className="text-[15px] text-text-3">{t("slider.unit")}</span>
        </div>

        <div className="relative mt-10">
          {/* zone track */}
          <div className="pointer-events-none absolute left-0 right-0 top-[10px] h-[3px]">
            {ZONES.map((z, i) => {
              const l = thumbOffset(z.startPos);
              const r = thumbOffset(z.endPos);
              const filled = Math.min(Math.max((pct / 100 - z.startPos) / (z.endPos - z.startPos), 0), 1);
              return (
                <div
                  key={z.plan.slug}
                  className="absolute top-0 h-full overflow-hidden rounded-full bg-white/[0.09]"
                  style={{
                    left: l,
                    width: `calc(${r} - ${l} - ${i + 1 < ZONES.length ? 3 : 0}px)`,
                  }}
                >
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${filled * 100}%` }}
                  />
                </div>
              );
            })}
          </div>

          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(pos)}
            aria-label={t("slider.label")}
            aria-valuetext={`${nf.format(volume)} ${t("slider.unit")}`}
            onChange={(e) => setVolume(posToVolume(parseInt(e.target.value, 10)))}
            className="corvo-range relative w-full"
          />

          {/* zone labels: plan names centered in their zone, limits on the boundaries */}
          <div className="relative mt-4 hidden h-11 @lg:block">
            {ZONES.map((z, i) => {
              const mid = (z.startPos + z.endPos) / 2;
              const on = z.plan.slug === plan.slug;
              const next = ZONES[i + 1];
              return (
                <button
                  key={z.plan.slug}
                  type="button"
                  onClick={() => setVolume(Math.round((z.from + (next?.from ?? MAX_VOLUME)) / 2))}
                  style={{ left: thumbOffset(mid) }}
                  className={cn(
                    "absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-[0.12em] transition-colors",
                    on ? "text-accent" : "text-text-4 hover:text-text-3"
                  )}
                >
                  {t(`plans.${z.plan.slug}.name`)}
                </button>
              );
            })}
            {[{ pos: 0, label: "1", edge: "start" }, ...ZONES.slice(1).map((z) => ({ pos: z.startPos, label: limitLabel(z.from - 1, locale), edge: "mid" })), { pos: 1, label: limitLabel(MAX_VOLUME, locale), edge: "end" }].map((m) => (
              <span
                key={m.pos}
                aria-hidden
                style={{ left: thumbOffset(m.pos) }}
                className={cn(
                  "absolute top-[18px] flex flex-col gap-1 font-mono text-[10px] tabular-nums text-text-4",
                  m.edge === "start" ? "items-start" : m.edge === "end" ? "-translate-x-full items-end" : "-translate-x-1/2 items-center"
                )}
              >
                <i className="block h-1.5 w-px bg-white/20" />
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      <div className="mt-12 grid gap-4 @4xl:grid-cols-[1.35fr_1fr]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={plan.slug}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <FeaturedPlan plan={plan} volume={volume} current={plan.slug === currentSlug} action={renderAction({ plan, volume, isCurrent: plan.slug === currentSlug })} />
          </motion.div>
        </AnimatePresence>

        <PlanLadder active={plan.slug} current={currentSlug} volume={volume} onPick={setVolume} />
      </div>
    </div>
  );
}
