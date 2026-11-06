"use client";

import { useTranslations } from "next-intl";
import { apiErrorMessage, invoiceErrorText } from "@/lib/api-errors";

/** The reason of a rejected invoice: `(code, message) => text`. */
export function useInvoiceErrorText(): (code: string | null | undefined, message: string | null | undefined) => string {
  const te = useTranslations("ApiErrors");
  return (code, message) => invoiceErrorText(code, message, te.has, te);
}

/** `(error, fallback) => text in the user's language`: the translation of the API's code, else `fallback`. */
export function useApiErrorText(): (error: unknown, fallback: string) => string {
  const te = useTranslations("ApiErrors");
  return (error, fallback) => apiErrorMessage(error, te.has, te, fallback);
}
