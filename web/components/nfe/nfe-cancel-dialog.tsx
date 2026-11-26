"use client";

import { useTranslations } from "next-intl";
import { cancelNfe, JUSTIFICATION_MAX, JUSTIFICATION_MIN, type NfeDocument } from "@/lib/nfe";
import { NfeReasonDialog } from "./nfe-reason-dialog";

interface NfeCancelDialogProps {
  nfe: Pick<NfeDocument, "id">;
  open: boolean;
  onClose: () => void;
  onCancelled: (updated: NfeDocument) => void;
}

/** Cancels an authorized NF-e at the SEFAZ: asks for the justification (15 to 255 characters). */
export function NfeCancelDialog({ nfe, open, onClose, onCancelled }: NfeCancelDialogProps) {
  const t = useTranslations("Nfe.cancel");
  return (
    <NfeReasonDialog
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t("description")}
      label={t("label")}
      submitLabel={t("submit")}
      min={JUSTIFICATION_MIN}
      max={JUSTIFICATION_MAX}
      danger
      onSubmit={async (justification) => onCancelled(await cancelNfe(nfe.id, justification))}
    />
  );
}
