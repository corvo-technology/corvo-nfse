"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { useOnboarding } from "@/lib/use-onboarding";
import { Button } from "@/components/ui/button";
import { CompanyForm } from "@/components/dashboard/company-form";
import { CertificateUpload } from "@/components/dashboard/certificate-upload";
import { DpsSequenceCard } from "@/components/companies/dps-sequence-card";
import { PlansInfo } from "@/components/onboarding/plans-info";

/**
 * First steps for a new account: a full-screen welcome over the dashboard, one step per screen
 * (no windows on top of windows, so it works on a phone). Every step can be skipped.
 */
export function OnboardingCard() {
  const t = useTranslations("Onboarding");
  const onboarding = useOnboarding();
  const [picked, setPicked] = useState<number | null>(null);

  const { steps, visible } = onboarding;
  const markRef = useRef(onboarding.mark);
  useEffect(() => { markRef.current = onboarding.mark; });
  const firstOpen = steps.findIndex((s) => !s.done);
  const index = Math.max(0, Math.min(picked ?? Math.max(firstOpen, 0), steps.length - 1));
  const step = steps[index];
  const onPlans = visible && step?.key === "plans";

  // The plans screen counts as seen as soon as it is shown.
  useEffect(() => { if (onPlans) markRef.current("plansSeen"); }, [onPlans]);

  if (!visible || !step) return null;

  const last = index === steps.length - 1;
  const next = () => (last ? onboarding.hide() : setPicked(index + 1));
  const completed = () => { onboarding.reload(); next(); };

  const shell = (children: React.ReactNode, footer: React.ReactNode) => (
    <section aria-labelledby="onboarding-title" className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex flex-none items-center justify-between px-5 py-4 sm:px-10 sm:py-5">
        <span className="text-[17px] font-semibold tracking-tight">{t("card.brand")}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onboarding.hide}>{t("card.hide")}</button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[580px] flex-col px-5 pb-8 pt-2 sm:px-0 sm:pt-8">{children}</div>
      </div>
      <footer className="flex-none border-t border-border bg-bg px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-10">
        <div className="mx-auto flex w-full max-w-[580px] items-center justify-between gap-3">{footer}</div>
      </footer>
    </section>
  );

  if (onboarding.allDone)
    return shell(
      <>
        <h1 id="onboarding-title" className="text-balance text-[28px] font-semibold leading-[1.1] tracking-tight sm:text-[32px]">{t("card.allDoneTitle")}</h1>
        <p className="mt-4 text-pretty text-[15px] leading-relaxed text-text-3">{t("card.allDoneBody")}</p>
      </>,
      <>
        <span />
        <Button variant="accent" onClick={onboarding.hide}>{t("card.hide")}</Button>
      </>
    );

  const lockedText = step.locked ? t(step.key === "note" ? "card.noteLocked" : "card.needsCompany") : null;

  const body = (() => {
    if (lockedText)
      return (
        <p className="flex items-start gap-2 rounded-[10px] border border-border p-4 text-sm text-text-3">
          <Lock size={15} className="mt-0.5 flex-none text-text-4" aria-hidden />{lockedText}
        </p>
      );
    switch (step.key) {
      case "plans":
        return <PlansInfo />;
      case "company":
        return (
          <CompanyForm
            onCancel={next}
            onSave={async (input) => {
              if (!input.taxRegime || !input.taxId) throw new Error("taxRegime and taxId are required");
              return companies.create({ ...input, taxRegime: input.taxRegime, taxId: input.taxId });
            }}
            onFinish={completed}
          />
        );
      case "certificate":
        return (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-3">{t("card.certificateHint")}</p>
            {onboarding.firstCompanyId && <CertificateUpload companyId={onboarding.firstCompanyId} onUploaded={completed} />}
          </div>
        );
      case "numbering":
        return (
          <div className="flex flex-col gap-3">
            {onboarding.firstCompanyId && <DpsSequenceCard companyId={onboarding.firstCompanyId} canManage />}
            <Button variant="ghost" className="self-start" onClick={() => { onboarding.mark("noPriorNotes"); completed(); }}>{t("card.noPrior")}</Button>
          </div>
        );
      case "note":
        return (
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm text-text-3">{t("card.noteHint")}</p>
            <Link href="/app/invoices/new" className="btn btn-accent">{t("card.issueNote")}</Link>
          </div>
        );
    }
  })();

  return shell(
    <>
      <div className="flex items-center gap-4">
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {steps.map((s, i) => <span key={s.key} className={`h-1 flex-1 rounded-full ${s.done ? "bg-accent" : i === index ? "bg-text-3" : "bg-track"}`} />)}
        </div>
        <span className="font-mono text-xs text-text-3">{t("card.stepOf", { n: index + 1, total: steps.length })}</span>
      </div>
      <h1 id="onboarding-title" className="mt-6 flex items-center gap-2 text-balance text-[26px] font-semibold leading-[1.15] tracking-tight sm:text-[30px]">
        {t(`steps.${step.key}`)}
        {step.done && <Check size={20} className="flex-none text-ok" aria-label={t("card.doneLabel")} />}
      </h1>
      <div className="mt-6">{body}</div>
    </>,
    <>
      {index > 0 ? <Button variant="ghost" onClick={() => setPicked(index - 1)}>{t("card.back")}</Button> : <span />}
      {last ? (
        <Button variant="accent" onClick={onboarding.hide}>{t("card.hide")}</Button>
      ) : step.done ? (
        <Button variant="accent" onClick={next}>{t("card.next")}</Button>
      ) : (
        <Button variant="secondary" onClick={next}>{t("card.skip")}</Button>
      )}
    </>
  );
}
