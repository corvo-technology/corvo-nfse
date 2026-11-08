"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** After this long without any number moving, say so, instead of leaving a screen that only looks frozen. */
export const STALLED_AFTER_MS = 2 * 60_000;

/**
 * The pulse of an import that is still running: when the screen last heard from the server, a calm
 * note when the connection drops (it keeps trying), and a plain word when nothing has moved for a while.
 */
export function ImportLiveStatus({ updatedAt, changedAt, reconnecting }: { updatedAt: number | null; changedAt: number | null; reconnecting: boolean }) {
  const t = useTranslations("Imports.live");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const seconds = updatedAt === null ? null : Math.max(0, Math.floor((now - updatedAt) / 1000));
  const stalledFor = changedAt === null ? 0 : now - changedAt;
  const stalled = !reconnecting && stalledFor >= STALLED_AFTER_MS;

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1">
      <p className="inline-flex items-center gap-2 font-mono text-[12px] text-text-3">
        <span aria-hidden className="relative flex h-2 w-2">
          {!reconnecting && <span className="absolute inline-flex h-full w-full rounded-full bg-ok/60 motion-safe:animate-ping" />}
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", reconnecting ? "bg-warn" : "bg-ok")} />
        </span>
        {reconnecting
          ? t("reconnecting")
          : seconds === null || seconds < 3
            ? t("live")
            : t("updated", { seconds })}
      </p>
      {stalled && (
        <p className="text-[13px] text-text-3">{t("stalled", { minutes: Math.floor(stalledFor / 60_000) })}</p>
      )}
    </div>
  );
}
