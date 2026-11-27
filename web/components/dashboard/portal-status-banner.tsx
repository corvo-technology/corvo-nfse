"use client";
import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { fiscalPortal, type FiscalPortalStatus } from "@/lib/api";

const POLL_MS = 60_000;

/** The time of day, plus the date when the outage did not start today. */
export function formatSince(date: Date, tag: string, now: Date = new Date()): string {
  const time = date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString(tag, { day: "2-digit", month: "2-digit" })} ${time}`;
}

/**
 * Says when the national NFS-e portal stopped answering, so waiting invoices do not look stuck.
 * Silent when the portal is fine or the status cannot be read.
 */
export function PortalStatusBanner({ environment }: { environment: string }) {
  const t = useTranslations("PortalStatus");
  const locale = useLocale();
  const [status, setStatus] = useState<FiscalPortalStatus | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fiscalPortal.status(abort.signal);
        if (!abort.signal.aborted) setStatus(next);
      } catch {
        // A failed read says nothing about the portal: keep the last known state.
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [environment]);

  if (status?.connection?.ourSide)
    return (
      <p role="status" className="banner banner-warn mb-6 flex items-start gap-2.5">
        <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <strong className="font-medium text-text">{t("ourSideTitle")}</strong> {t("ourSideBody")}
        </span>
      </p>
    );
  if (!status || status.available) return null;
  const since = status.since ? formatSince(new Date(status.since), locale === "pt" ? "pt-BR" : "en-US") : null;
  return (
    <p role="status" className="banner banner-warn mb-6 flex items-start gap-2.5">
      <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-medium text-text">{since ? t("titleSince", { time: since }) : t("title")}</strong>{" "}
        {t("body")}
      </span>
    </p>
  );
}
