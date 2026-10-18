import type { Invoice } from "@/lib/types";

/** A scheduled invoice stays `queued` until `scheduledFor`; there is no separate status on the wire. */
export function isScheduled(invoice: Pick<Invoice, "status" | "scheduledFor">, now = Date.now()): boolean {
  return invoice.status === "queued" && !!invoice.scheduledFor && new Date(invoice.scheduledFor).getTime() > now;
}

export function formatScheduledDate(value: string, locale: string, withTime = false): string {
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}
