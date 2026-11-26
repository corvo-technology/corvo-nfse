"use client";

import { useTranslations } from "next-intl";
import { correctNfe, CORRECTION_MAX, JUSTIFICATION_MIN, type NfeDocument, type NfeFiscalEvent } from "@/lib/nfe";
import { NfeReasonDialog } from "./nfe-reason-dialog";

interface NfeCorrectionDialogProps {
  nfe: Pick<NfeDocument, "id">;
  open: boolean;
  onClose: () => void;
  onCorrected: (event: NfeFiscalEvent) => void;
}

/** Sends a correction letter (CC-e): it fixes text such as the delivery address, never values, taxes, parties or dates. */
export function NfeCorrectionDialog({ nfe, open, onClose, onCorrected }: NfeCorrectionDialogProps) {
  const t = useTranslations("Nfe.correction");
  return (
    <NfeReasonDialog
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t("description")}
      label={t("label")}
      submitLabel={t("submit")}
      min={JUSTIFICATION_MIN}
      max={CORRECTION_MAX}
      onSubmit={async (correction) => onCorrected(await correctNfe(nfe.id, correction))}
    />
  );
}
