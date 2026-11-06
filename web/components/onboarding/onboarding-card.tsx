"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Circle, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { useOnboarding } from "@/lib/use-onboarding";
import type { StepKey } from "@/lib/onboarding-steps";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { CompanyForm } from "@/components/dashboard/company-form";
import { CertificateUpload } from "@/components/dashboard/certificate-upload";
import { DpsSequenceCard } from "@/components/companies/dps-sequence-card";
import { PlansDialog } from "@/components/onboarding/plans-dialog";

/** First steps for a new account. Every step is optional and the card can be hidden. */
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

  if (onboarding.allDone)
    return (
      <Card className="flex flex-col gap-1 p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-medium">{t("card.allDoneTitle")}</h2>
          <Button variant="ghost" onClick={onboarding.hide}>{t("card.hide")}</Button>
        </div>
        <p className="text-sm text-text-3">{t("card.allDoneBody")}</p>
      </Card>
    );

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">{t("card.title")}</h2>
          <p className="mt-1 text-sm text-text-3">{t("card.subtitle")}</p>
        </div>
        <div className="flex flex-none items-center gap-3">
          <span className="font-mono text-xs text-text-3">{t("card.progress", { done: onboarding.done, total: onboarding.total })}</span>
          <Button variant="ghost" onClick={onboarding.hide}>{t("card.hide")}</Button>
        </div>
      </div>
      <ul className="flex flex-col">
        {onboarding.steps.map((step) => {
          const label = t(`steps.${step.key}`);
          const icon = step.done ? <Check size={16} className="text-ok" aria-label={t("card.doneLabel")} /> : step.locked ? <Lock size={16} className="text-text-4" aria-hidden /> : <Circle size={16} className="text-text-4" aria-hidden />;
          return (
            <li key={step.key} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
              {icon}
              <div className="min-w-0 flex-1">
                {step.key === "note" ? (
                  step.locked ? (
                    <><p className="text-sm text-text-3">{label}</p><p className="text-[12.5px] text-text-4">{t("card.noteLocked")}</p></>
                  ) : (
                    <Link href="/app/invoices/new" className="inline-flex items-center gap-1 text-sm font-medium">{label}<ChevronRight size={14} aria-hidden /></Link>
                  )
                ) : (
                  <button type="button" className="inline-flex items-center gap-1 text-left text-sm font-medium" onClick={() => start(step.key as Exclude<StepKey, "note">)}>{label}<ChevronRight size={14} aria-hidden /></button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

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
    </Card>
  );
}
