"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { useOnboarding } from "@/lib/use-onboarding";
import type { StepKey } from "@/lib/onboarding-steps";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CompanyForm } from "@/components/dashboard/company-form";
import { CertificateUpload } from "@/components/dashboard/certificate-upload";
import { DpsSequenceCard } from "@/components/companies/dps-sequence-card";
import { PlansDialog } from "@/components/onboarding/plans-dialog";

/** First steps for a new account: a full-screen welcome over the dashboard. Every step is optional and it can be skipped. */
export function OnboardingCard() {
  const t = useTranslations("Onboarding");
  const onboarding = useOnboarding();
  const [open, setOpen] = useState<Exclude<StepKey, "note"> | null>(null);
  if (!onboarding.visible) return null;

  const close = () => { setOpen(null); onboarding.reload(); };
  const start = (key: Exclude<StepKey, "note">) => {
    if (key === "plans") onboarding.mark("plansSeen");
    setOpen(key);
  };

  const skip = (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onboarding.hide}>{t("card.hide")}</button>
  );

  const shell = (children: React.ReactNode) => (
    <section aria-labelledby="onboarding-title" className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg">
      <header className="flex flex-none items-center justify-between px-6 py-5 sm:px-10">
        <span className="text-[17px] font-semibold tracking-tight">{t("card.brand")}</span>
        {skip}
      </header>
      <div className="mx-auto flex w-full max-w-[580px] flex-1 flex-col justify-center px-6 pb-16 sm:px-0">{children}</div>
    </section>
  );

  const modals = (
    <>
      <PlansDialog open={open === "plans"} onClose={close} />
      <Modal open={open === "company"} onClose={close} title={t("steps.company")} wide>
        <CompanyForm
          onCancel={close}
          onSave={async (input) => {
            if (!input.taxRegime || !input.taxId) throw new Error("taxRegime and taxId are required");
            return companies.create({ ...input, taxRegime: input.taxRegime, taxId: input.taxId });
          }}
          onFinish={close}
        />
      </Modal>
      <Modal open={open === "certificate" && onboarding.firstCompanyId !== null} onClose={close} title={t("steps.certificate")}>
        {onboarding.firstCompanyId && <CertificateUpload companyId={onboarding.firstCompanyId} onUploaded={close} />}
      </Modal>
      <Modal open={open === "numbering" && onboarding.firstCompanyId !== null} onClose={close} title={t("steps.numbering")}>
        {onboarding.firstCompanyId && (
          <div className="flex flex-col gap-3">
            <DpsSequenceCard companyId={onboarding.firstCompanyId} canManage />
            <Button variant="ghost" onClick={() => { onboarding.mark("noPriorNotes"); close(); }}>{t("card.noPrior")}</Button>
          </div>
        )}
      </Modal>
    </>
  );

  if (onboarding.allDone)
    return (
      <>
        {shell(
          <>
            <h1 id="onboarding-title" className="text-balance text-[32px] font-semibold leading-[1.1] tracking-tight">{t("card.allDoneTitle")}</h1>
            <p className="mt-4 text-pretty text-[15px] leading-relaxed text-text-3">{t("card.allDoneBody")}</p>
            <button type="button" className="btn btn-accent mt-8 self-start" onClick={onboarding.hide}>{t("card.hide")}</button>
          </>
        )}
        {modals}
      </>
    );

  return (
    <>
      {shell(
        <>
          <h1 id="onboarding-title" className="text-balance text-[32px] font-semibold leading-[1.1] tracking-tight">{t("card.title")}</h1>
          <p className="mt-3 text-pretty text-[15px] leading-relaxed text-text-3">{t("card.subtitle")}</p>
          <div className="mt-8 flex items-center gap-4">
            <div className="flex flex-1 gap-1.5" aria-hidden>
              {onboarding.steps.map((step) => <span key={step.key} className={`h-1 flex-1 rounded-full ${step.done ? "bg-accent" : "bg-track"}`} />)}
            </div>
            <span className="font-mono text-xs text-text-3">{t("card.progress", { done: onboarding.done, total: onboarding.total })}</span>
          </div>
          <ul className="mt-6 flex flex-col border-y border-border">
            {onboarding.steps.map((step, index) => {
              const label = t(`steps.${step.key}`);
              const number = <span className="w-6 flex-none font-mono text-xs text-text-4" aria-hidden>{String(index + 1).padStart(2, "0")}</span>;
              const row = "flex w-full items-center gap-3 py-4 text-left";
              const state = step.done
                ? <span className="flex items-center gap-1.5 text-[13px] text-ok"><Check size={15} aria-hidden />{t("card.doneLabel")}</span>
                : <span className="flex items-center gap-1 text-[13px] text-text-3">{t("card.start")}<ChevronRight size={14} aria-hidden /></span>;
              return (
                <li key={step.key} className="border-t border-border first:border-t-0">
                  {step.locked ? (
                    <div className={`${row} opacity-60`}>
                      {number}
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px]">{label}</p>
                        <p className="mt-0.5 text-[12.5px] text-text-4">{t(step.key === "note" ? "card.noteLocked" : "card.needsCompany")}</p>
                      </div>
                      <Lock size={15} className="flex-none text-text-4" aria-hidden />
                    </div>
                  ) : step.key === "note" ? (
                    <Link href="/app/invoices/new" aria-label={label} className={`${row} -mx-3 rounded-lg px-3 hover:bg-hover`}>
                      {number}<span className="flex-1 text-[15px] font-medium">{label}</span>{state}
                    </Link>
                  ) : (
                    <button type="button" aria-label={label} className={`${row} -mx-3 cursor-pointer rounded-lg px-3 hover:bg-hover`} onClick={() => start(step.key as Exclude<StepKey, "note">)}>
                      {number}<span className="flex-1 text-[15px] font-medium">{label}</span>{state}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-[13px] text-text-4">{t("card.footnote")}</p>
        </>
      )}
      {modals}
    </>
  );
}
