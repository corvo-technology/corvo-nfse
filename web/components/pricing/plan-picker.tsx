"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  AVULSO_MIN_UNITS,
  AVULSO_UNIT_CENTS,
  MAX_CALCULATOR_NOTES,
  PLANS,
  chargeTotalCents,
  perMonthCents,
  recommendForNotes,
  type BillingCycle,
  type NotesOption,
  type PlanSlug,
  type PlanTier,
} from "@/lib/plans-catalog";

export { PLANS, type PlanSlug, type PlanTier, type BillingCycle };

/** "R$ 1.234,56". Same format in both locales: prices are always in BRL. */
export function formatBRL(cents: number): string {
  const [int, dec] = (cents / 100).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

export const BADGED_PLANS: ReadonlySet<PlanSlug> = new Set(["equipe"]);
export const HIGHLIGHTED_PLAN: PlanSlug = "equipe";

export interface PickerActionContext {
  /** null = no plan: single notes only. */
  plan: PlanTier | null;
  cycle: BillingCycle;
  /** Single notes to top the plan up with (or to buy alone when plan is null). */
  avulsoUnits: number;
  isCurrent: boolean;
}

const INCLUDES = ["nfse", "companies", "email", "mcp", "webhooks", "downloads"] as const;
const planTitle = (slug: PlanSlug) => slug.charAt(0).toUpperCase() + slug.slice(1);
const zoneKey = (slug: PlanSlug | null) => slug ?? "avulso";

/** Cost of one note: a fraction of a cent matters, so keep four decimals below R$ 1. */
export function formatBRLPerNote(cents: number): string {
  const reais = cents / 100;
  return `R$ ${reais.toFixed(reais >= 1 ? 2 : 4).replace(".", ",")}`;
}

function CycleToggle({ cycle, onChange }: { cycle: BillingCycle; onChange: (c: BillingCycle) => void }) {
  const t = useTranslations("Pricing");
  return (
    <div role="radiogroup" aria-label={t("cycle.label")} className="mx-auto inline-flex rounded-full border border-white/10 p-1">
      {(["monthly", "annual"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={cycle === value}
          data-testid={`cycle-${value}`}
          onClick={() => onChange(value)}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] transition-colors",
            cycle === value ? "bg-accent text-[#0a0a0a]" : "text-text-2 hover:text-text"
          )}
        >
          {t(`cycle.${value}`)}
          {value === "annual" && <span className="font-mono text-[10px] font-semibold">{t("cycle.annualBadge")}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Slider: log scale from 3 notes, one zone per option ─────── */

const SLIDER_MIN = AVULSO_MIN_UNITS;
const SLIDER_MAX = 3000;
const THUMB = 22;
const LOG_MAX = Math.log(SLIDER_MAX / SLIDER_MIN);

function posToNotes(pos: number): number {
  const raw = SLIDER_MIN * Math.exp((pos / 1000) * LOG_MAX);
  const step = raw > 1000 ? 50 : raw > 200 ? 10 : raw > 50 ? 5 : 1;
  return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(raw / step) * step));
}

function notesToPos(notes: number): number {
  const clamped = Math.min(Math.max(notes, SLIDER_MIN), SLIDER_MAX);
  return (Math.log(clamped / SLIDER_MIN) / LOG_MAX) * 1000;
}

const thumbOffset = (p: number) => `calc(${p * 100}% + ${(0.5 - p) * THUMB}px)`;

/** First volume where each option becomes the cheapest: drives the zones on the track. */
function buildZones(cycle: BillingCycle) {
  const starts: { slug: PlanSlug | null; from: number }[] = [];
  for (let n = SLIDER_MIN; n <= SLIDER_MAX; n++) {
    const slug = recommendForNotes(n, cycle)!.option.planSlug;
    if (starts.length === 0 || starts[starts.length - 1].slug !== slug) starts.push({ slug, from: n });
  }
  return starts.map((z, i) => ({
    ...z,
    startPos: notesToPos(z.from) / 1000,
    endPos: i + 1 < starts.length ? notesToPos(starts[i + 1].from) / 1000 : 1,
  }));
}

/* ── Featured option (the answer to the slider) ──────────────── */

function FeaturedOption({
  option,
  notes,
  cycle,
  isCurrent,
  action,
}: {
  option: NotesOption;
  notes: number;
  cycle: BillingCycle;
  isCurrent: boolean;
  action: ReactNode;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const plan = option.planSlug ? PLANS.find((p) => p.slug === option.planSlug)! : null;
  const avulsoCents = option.avulsoUnits * AVULSO_UNIT_CENTS;
  const planCents = plan ? perMonthCents(plan, cycle) : 0;
  const strike = cycle === "annual" && plan ? plan.monthlyCents + avulsoCents : null;
  const planPct = option.totalCents > 0 ? (planCents / option.totalCents) * 100 : 0;

  return (
    <div data-testid="featured-plan" className="relative rounded-[16px] border border-accent/40 bg-accent-surface p-6 @lg:p-9">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="whitespace-nowrap font-mono text-[12px] tracking-[0.14em] text-text">{plan ? t(`plans.${plan.slug}.name`) : t("featured.avulsoName")}</span>
        {plan && BADGED_PLANS.has(plan.slug) && (
          <span className="whitespace-nowrap rounded-full border border-accent/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">{t(`plans.${plan.slug}.badge`)}</span>
        )}
        <span className="shrink-0 whitespace-nowrap rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#0a0a0a]">
          {isCurrent ? t("currentPlan") : t("featured.recommended")}
        </span>
      </div>
      <p className="mt-3 text-[14px] text-text-3">{plan ? t(`plans.${plan.slug}.bestFor`) : t("featured.avulsoBestFor")}</p>

      <div className="mt-8 flex flex-wrap items-end gap-x-3 gap-y-1">
        {strike !== null && <s className="mb-2 text-[20px] text-text-3 tabular-nums">{formatBRL(strike)}</s>}
        <span className="text-[48px] font-semibold leading-[0.9] tracking-[-0.03em] text-text tabular-nums @lg:text-[64px] @5xl:text-[76px]">{formatBRL(option.totalCents)}</span>
        <span className="mb-2 text-[15px] text-text-3">{t("perMonth")}</span>
      </div>
      <p className="mt-3 text-[15px] text-text-2">
        {t("featured.effective")} <span className="font-semibold text-text">{formatBRLPerNote(option.totalCents / notes)} {t("featured.perNote")}</span>
      </p>
      {plan && cycle === "annual" && <p className="mt-1 text-[13px] text-text-3">{t("billedOnce", { total: formatBRL(chargeTotalCents(plan, cycle)) })}</p>}

      <div className="mt-6">
        <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.09]">
          <div className="h-full bg-accent" style={{ width: `${planPct}%` }} />
          <div className="h-full bg-warn/70" style={{ width: `${100 - planPct}%` }} />
        </div>
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-text-2">
          {plan && (
            <li className="flex items-center gap-2">
              <i className="inline-block h-2 w-2 rounded-full bg-accent" />
              {t("featured.planLine", { count: nf.format(plan.credits) })} <span className="text-text">{formatBRL(planCents)}</span>
            </li>
          )}
          {option.avulsoUnits > 0 && (
            <li className="flex items-center gap-2">
              <i className="inline-block h-2 w-2 rounded-full bg-warn/70" />
              {t("calculator.extra", { count: nf.format(option.avulsoUnits) })} <span className="text-text">{formatBRL(avulsoCents)}</span>
            </li>
          )}
        </ul>
      </div>

      {plan && (
        <ul className="mt-8 grid gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-[14px] text-text-2 @lg:grid-cols-2">
          {INCLUDES.map((key) => (
            <li key={key} className="flex items-center gap-2.5">
              <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
              {t(`plans.${plan.slug}.includes.${key}`)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8">{action}</div>
    </div>
  );
}

/* ── Ladder: every option, click to jump the slider ──────────── */

function Ladder({ activeKey, cycle, currentSlug, onPick }: { activeKey: string; cycle: BillingCycle; currentSlug?: string; onPick: (notes: number) => void }) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const rowCls = (on: boolean) =>
    cn("flex w-full items-center justify-between gap-4 rounded-[12px] border px-5 py-4 text-left transition-colors", on ? "border-accent/30 bg-white/[0.04]" : "border-transparent hover:bg-white/[0.03]");
  return (
    <div className="rounded-[16px] border border-white/10 p-4 @lg:p-6">
      <p className="px-2 pb-3 font-mono text-[11px] tracking-[0.14em] text-text-3">{t("featured.allPlans")}</p>
      <div className="flex flex-col gap-1">
        <button type="button" data-plan="avulso" aria-current={activeKey === "avulso"} onClick={() => onPick(SLIDER_MIN)} className={rowCls(activeKey === "avulso")}>
          <span>
            <span className="block font-mono text-[12px] tracking-[0.14em] text-text">{t("featured.avulsoName")}</span>
            <span className="mt-1 block text-[13px] text-text-3">{t("featured.avulsoBestFor")}</span>
          </span>
          <span className="text-right text-[15px] font-semibold text-text tabular-nums">{formatBRL(AVULSO_UNIT_CENTS)}<span className="block text-[11px] font-normal text-text-3">{t("featured.perNote")}</span></span>
        </button>
        {PLANS.map((plan) => (
          <button key={plan.slug} type="button" data-plan={plan.slug} aria-current={activeKey === plan.slug} onClick={() => onPick(plan.credits)} className={rowCls(activeKey === plan.slug)}>
            <span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] tracking-[0.14em] text-text">{t(`plans.${plan.slug}.name`)}</span>
                {BADGED_PLANS.has(plan.slug) && <span className="rounded-full border border-accent/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">{t(`plans.${plan.slug}.badge`)}</span>}
                {plan.slug === currentSlug && <span className="text-[11px] text-accent">{t("currentPlan")}</span>}
              </span>
              <span className="mt-1 block text-[13px] text-text-3">{t("notesPerMonth", { count: nf.format(plan.credits) })}</span>
            </span>
            <span className="text-right text-[15px] font-semibold text-text tabular-nums">
              {cycle === "annual" && <s className="mr-2 text-[12px] font-normal text-text-3">{formatBRL(plan.monthlyCents)}</s>}
              {formatBRL(perMonthCents(plan, cycle))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PlanPicker({
  currentSlug,
  renderAction,
}: {
  /** Plan the account is on today. */
  currentSlug?: string;
  renderAction: (ctx: PickerActionContext) => ReactNode;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [notes, setNotes] = useState(250);
  const [draft, setDraft] = useState<string | null>(null);
  const zones = useMemo(() => buildZones(cycle), [cycle]);
  const result = recommendForNotes(notes, cycle)!;
  const active = zoneKey(result.option.planSlug);
  const plan = result.option.planSlug ? PLANS.find((p) => p.slug === result.option.planSlug)! : null;
  const pos = notesToPos(notes);
  const shown = draft ?? nf.format(notes);
  const zoneName = (slug: PlanSlug | null) => (slug ? planTitle(slug).toUpperCase() : t("calculator.zoneAvulso"));

  function onType(value: string) {
    const digits = value.replace(/\D/g, "");
    setDraft(digits);
    const n = Number(digits);
    if (digits !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_CALCULATOR_NOTES) setNotes(n);
  }

  return (
    <div className="@container">
      <div className="text-center">
        <CycleToggle cycle={cycle} onChange={setCycle} />
      </div>

      <div className="mx-auto mt-10 max-w-[820px]">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">{t("calculator.title")}</p>
        <div className="mt-4 flex items-baseline justify-center gap-3">
          <input
            type="text"
            inputMode="numeric"
            aria-label={t("calculator.label")}
            value={shown}
            onFocus={(e) => {
              setDraft(String(notes));
              e.currentTarget.select();
            }}
            onChange={(e) => onType(e.target.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            style={{ width: `${Math.max(2, shown.length + 0.5)}ch` }}
            className="border-b border-dashed border-white/15 bg-transparent text-center text-[56px] font-semibold leading-none tracking-[-0.045em] text-text tabular-nums transition-colors focus:border-accent focus:outline-none"
          />
          <span className="text-[15px] text-text-3">{t("calculator.unit")}</span>
        </div>

        <div className="relative mt-10">
          <div className="pointer-events-none absolute left-0 right-0 top-[10px] h-[3px]">
            {zones.map((z, i) => {
              const l = thumbOffset(z.startPos);
              const r = thumbOffset(z.endPos);
              const filled = Math.min(Math.max((pos / 1000 - z.startPos) / (z.endPos - z.startPos), 0), 1);
              return (
                <div key={zoneKey(z.slug)} data-zone={zoneKey(z.slug)} className="absolute top-0 h-full overflow-hidden rounded-full bg-white/[0.09]" style={{ left: l, width: `calc(${r} - ${l} - ${i + 1 < zones.length ? 3 : 0}px)` }}>
                  <div className="h-full bg-accent" style={{ width: `${filled * 100}%` }} />
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
            aria-label={t("calculator.slider")}
            aria-valuetext={`${nf.format(notes)} ${t("calculator.unit")}`}
            onChange={(e) => {
              setDraft(null);
              setNotes(posToNotes(parseInt(e.target.value, 10)));
            }}
            className="corvo-range relative w-full"
          />
          <div className="relative mt-4 hidden h-11 sm:block">
            {zones.map((z, i) => {
              const next = zones[i + 1];
              return (
                <button
                  key={zoneKey(z.slug)}
                  type="button"
                  onClick={() => setNotes(Math.round((z.from + (next?.from ?? SLIDER_MAX)) / 2))}
                  style={{ left: thumbOffset((z.startPos + z.endPos) / 2) }}
                  className={cn("absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-[0.12em] transition-colors", zoneKey(z.slug) === active ? "text-accent" : "text-text-4 hover:text-text-3")}
                >
                  {zoneName(z.slug)}
                </button>
              );
            })}
            {[{ pos: 0, label: String(SLIDER_MIN), edge: "start" }, ...zones.slice(1).map((z) => ({ pos: z.startPos, label: String(z.from - 1), edge: "mid" })), { pos: 1, label: nf.format(SLIDER_MAX), edge: "end" }].map((m) => (
              <span
                key={m.pos}
                aria-hidden
                style={{ left: thumbOffset(m.pos) }}
                className={cn("absolute top-[18px] flex flex-col gap-1 font-mono text-[10px] tabular-nums text-text-4", m.edge === "start" ? "items-start" : m.edge === "end" ? "-translate-x-full items-end" : "-translate-x-1/2 items-center")}
              >
                <i className="block h-1.5 w-px bg-white/20" />
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-4 @4xl:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <FeaturedOption
          option={result.option}
          notes={notes}
          cycle={cycle}
          isCurrent={plan?.slug === currentSlug}
          action={renderAction({ plan, cycle, avulsoUnits: result.option.avulsoUnits, isCurrent: plan?.slug === currentSlug })}
        />
        <Ladder activeKey={active} cycle={cycle} currentSlug={currentSlug} onPick={(n) => { setDraft(null); setNotes(n); }} />
      </div>
    </div>
  );
}

export { AVULSO_MIN_UNITS, AVULSO_UNIT_CENTS };
