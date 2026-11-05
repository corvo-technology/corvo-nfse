"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  AVULSO_MIN_UNITS,
  AVULSO_UNIT_CENTS,
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

function NotesCalculator({ cycle }: { cycle: BillingCycle }) {
  const t = useTranslations("Pricing");
  const [raw, setRaw] = useState("");
  const notes = raw === "" ? null : Number(raw);
  const result = notes === null ? null : recommendForNotes(notes, cycle);
  return (
    <section className="mx-auto mt-14 max-w-[640px] text-center">
      <h3 className="text-[20px] font-semibold text-text">{t("calculator.title")}</h3>
      <label className="mt-4 block text-[13px] text-text-3">
        {t("calculator.label")}
        <input
          type="text"
          inputMode="numeric"
          placeholder={t("calculator.placeholder")}
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 block w-full rounded-[10px] border border-white/15 bg-transparent px-4 py-3 text-center text-[20px] text-text tabular-nums focus:border-accent focus:outline-none"
        />
      </label>
      {notes !== null && !result && <p role="alert" className="mt-3 text-[13px] text-warn">{t("calculator.invalid")}</p>}
      {result && (
        <div data-testid="calculator-result" className="mt-5 rounded-[12px] border border-accent/40 bg-accent-surface p-5 text-left">
          <p className="font-mono text-[11px] tracking-[0.14em] text-text-3">{t("calculator.result")}</p>
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
