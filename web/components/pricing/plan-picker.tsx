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
  plan: PlanTier;
  cycle: BillingCycle;
  isCurrent: boolean;
}

const INCLUDES = ["nfse", "companies", "email", "mcp", "webhooks", "downloads"] as const;

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

function PlanCard({ plan, cycle, isCurrent, action }: { plan: PlanTier; cycle: BillingCycle; isCurrent: boolean; action: ReactNode }) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const highlighted = plan.slug === HIGHLIGHTED_PLAN;
  return (
    <div
      data-plan={plan.slug}
      className={cn(
        "flex flex-col rounded-[16px] border p-6",
        highlighted ? "border-accent/60 bg-accent-surface" : "border-white/10"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] tracking-[0.14em] text-text">{t(`plans.${plan.slug}.name`)}</span>
        {BADGED_PLANS.has(plan.slug) && (
          <span className="whitespace-nowrap rounded-full border border-accent/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
            {t(`plans.${plan.slug}.badge`)}
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] text-text-3">{t(`plans.${plan.slug}.bestFor`)}</p>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-2">
        {cycle === "annual" && <s className="text-[16px] text-text-3 tabular-nums">{formatBRL(plan.monthlyCents)}</s>}
        <span className="text-[36px] font-semibold leading-none tracking-[-0.03em] text-text tabular-nums">{formatBRL(perMonthCents(plan, cycle))}</span>
        <span className="text-[14px] text-text-3">{t("perMonth")}</span>
      </div>
      {cycle === "annual" && (
        <p className="mt-1 text-[12px] text-text-3">{t("billedOnce", { total: formatBRL(chargeTotalCents(plan, cycle)) })}</p>
      )}
      <p className="mt-4 text-[15px] font-medium text-text">{t("notesPerMonth", { count: nf.format(plan.credits) })}</p>

      <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-text-2">
        {INCLUDES.map((key) => (
          <li key={key}>{t(`plans.${plan.slug}.includes.${key}`)}</li>
        ))}
      </ul>
      <div className="mt-6">{isCurrent ? <span className="text-[14px] text-accent">{t("currentPlan")}</span> : action}</div>
    </div>
  );
}

const planTitle = (slug: PlanSlug) => slug.charAt(0).toUpperCase() + slug.slice(1);

function optionLabel(option: NotesOption, t: ReturnType<typeof useTranslations>): string {
  const parts = [option.planSlug ? t("calculator.plan", { name: planTitle(option.planSlug) }) : t("calculator.avulsoOnly")];
  if (option.planSlug && option.avulsoUnits > 0) parts.push(t("calculator.extra", { count: option.avulsoUnits }));
  return parts.join(" ");
}

/* ── Notes calculator: a slider on a log scale with one zone per option ── */

const SLIDER_MIN = 1;
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
const zoneKey = (slug: PlanSlug | null) => slug ?? "avulso";

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
    to: i + 1 < starts.length ? starts[i + 1].from - 1 : SLIDER_MAX,
  }));
}

function NotesCalculator({ cycle }: { cycle: BillingCycle }) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const [notes, setNotes] = useState(250);
  const [draft, setDraft] = useState<string | null>(null);
  const zones = useMemo(() => buildZones(cycle), [cycle]);
  const result = recommendForNotes(notes, cycle);
  const pos = notesToPos(notes);
  const pct = pos / 1000;
  const shown = draft ?? nf.format(notes);
  const active = zoneKey(result?.option.planSlug ?? null);
  const zoneName = (slug: PlanSlug | null) => (slug ? planTitle(slug).toUpperCase() : t("calculator.zoneAvulso"));

  function onType(value: string) {
    const digits = value.replace(/\D/g, "");
    setDraft(digits);
    const n = Number(digits);
    if (digits !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_CALCULATOR_NOTES) setNotes(n);
  }

  return (
    <section className="mx-auto mt-16 max-w-[820px]">
      <p className="text-center font-mono text-[11px] tracking-[0.16em] text-text-3 uppercase">{t("calculator.title")}</p>

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
            const filled = Math.min(Math.max((pct - z.startPos) / (z.endPos - z.startPos), 0), 1);
            return (
              <div
                key={zoneKey(z.slug)}
                data-zone={zoneKey(z.slug)}
                className="absolute top-0 h-full overflow-hidden rounded-full bg-white/[0.09]"
                style={{ left: l, width: `calc(${r} - ${l} - ${i + 1 < zones.length ? 3 : 0}px)` }}
              >
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
            const mid = (z.startPos + z.endPos) / 2;
            const on = zoneKey(z.slug) === active;
            const next = zones[i + 1];
            return (
              <button
                key={zoneKey(z.slug)}
                type="button"
                onClick={() => setNotes(Math.round((z.from + (next?.from ?? SLIDER_MAX)) / 2))}
                style={{ left: thumbOffset(mid) }}
                className={cn(
                  "absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-[0.12em] transition-colors",
                  on ? "text-accent" : "text-text-4 hover:text-text-3"
                )}
              >
                {zoneName(z.slug)}
              </button>
            );
          })}
          {[{ pos: 0, label: "1", edge: "start" }, ...zones.slice(1).map((z) => ({ pos: z.startPos, label: String(z.from - 1), edge: "mid" })), { pos: 1, label: nf.format(SLIDER_MAX), edge: "end" }].map((m) => (
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

      {result && (
        <div data-testid="calculator-result" className="mt-10 rounded-[12px] border border-accent/40 bg-accent-surface p-5">
          <p className="font-mono text-[11px] text-text-3">{t("calculator.result")}</p>
          <p className="mt-2 text-[18px] font-medium text-text">{optionLabel(result.option, t)}</p>
          <p className="mt-1 text-[14px] text-text-2">
            {t("calculator.total")}: <span className="font-semibold text-text tabular-nums">{formatBRL(result.option.totalCents)}</span>
            {t("perMonth")}
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-[12px] text-text-3">
            {result.alternatives.map((alt) => (
              <li key={`${alt.planSlug}-${alt.avulsoUnits}`}>
                {optionLabel(alt, t)}: {formatBRL(alt.totalCents)}
                {t("perMonth")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PlanPicker({
  currentSlug,
  renderAction,
}: {
  /** Plan the account is on today; its card shows "Seu plano" instead of an action. */
  currentSlug?: string;
  renderAction: (ctx: PickerActionContext) => ReactNode;
}) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  return (
    <div className="@container">
      <div className="text-center">
        <CycleToggle cycle={cycle} onChange={setCycle} />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.slug === currentSlug;
          return <PlanCard key={plan.slug} plan={plan} cycle={cycle} isCurrent={isCurrent} action={renderAction({ plan, cycle, isCurrent })} />;
        })}
      </div>
      <NotesCalculator cycle={cycle} />
    </div>
  );
}

export { AVULSO_MIN_UNITS, AVULSO_UNIT_CENTS };
