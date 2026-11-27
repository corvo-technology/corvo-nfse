"use client";

import { useTranslations } from "next-intl";
import { explainError } from "@/lib/integrations";

/** `(raw) => plain text`: a reason code, a known technical message or, last, the raw text under a generic sentence. */
export function useIntegrationErrorText(): (raw: string | null | undefined) => string {
  const t = useTranslations("Integrations");
  return (raw) => {
    const found = explainError(raw);
    if (!found) return "";
    if (found.kind === "reason") return t(`reasons.${found.code}.title`);
    if (found.kind === "known") return t(`errors.${found.key}`);
    return `${t("errors.unknown")} ${found.raw}`;
  };
}

/** What to do about a reason code, or an empty text when the code is not one we know. */
export function useReasonAction(): (code: string | null | undefined) => string {
  const t = useTranslations("Integrations");
  return (code) => {
    const found = explainError(code);
    return found?.kind === "reason" ? t(`reasons.${found.code}.action`) : "";
  };
}
