"use client";

import type { KeyboardEvent } from "react";
import { FlaskConical, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

export type FiscalEnv = "test" | "live";

interface EnvSwitchProps {
  value: FiscalEnv;
  onChange: (env: FiscalEnv) => void;
  /** Draws attention to the selector (used once, after the first test note). */
  highlight?: boolean;
}

const OPTIONS: FiscalEnv[] = ["test", "live"];

export function EnvSwitch({ value, onChange, highlight }: EnvSwitchProps) {
  const t = useTranslations("Topbar");
  const isLive = value === "live";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: FiscalEnv = value === "test" ? "live" : "test";
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-env="${next}"]`)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("environment")}
      onKeyDown={onKeyDown}
      data-env-state={value}
      data-highlight={highlight ? "true" : undefined}
      className={`relative grid h-9 grid-cols-2 items-center rounded-full border border-border bg-surface-alt p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] ${highlight ? "animate-pulse ring-2 ring-accent" : ""}`}
    >
      {/* Ambient glow that follows the active environment */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-full transition-opacity duration-500 ${
          isLive ? "opacity-100" : "opacity-0"
        }`}
        style={{ boxShadow: "0 0 18px -4px color-mix(in oklch, var(--accent) 45%, transparent)" }}
      />

      {/* Sliding thumb */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full border transition-[transform,background-color,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)] motion-reduce:transition-none"
        style={{
          transform: isLive ? "translateX(100%)" : "translateX(0)",
          backgroundColor: isLive
            ? "color-mix(in oklch, var(--accent) 16%, var(--surface))"
            : "color-mix(in oklch, var(--warn) 14%, var(--surface))",
          borderColor: isLive
            ? "color-mix(in oklch, var(--accent) 50%, transparent)"
            : "color-mix(in oklch, var(--warn) 40%, transparent)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.4)",
        }}
      />

      {OPTIONS.map((env) => {
        const active = value === env;
        const live = env === "live";
        const Icon = live ? Radio : FlaskConical;
        const tone = live ? "text-accent" : "text-warn";
        return (
          <button
            key={env}
            type="button"
            role="radio"
            data-env={env}
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(env)}
            className={`relative z-10 flex h-full cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors duration-200 sm:min-w-[5.5rem] ${
              active ? tone : "text-text-3 hover:text-text-2"
            }`}
          >
            {live ? (
              <span aria-hidden className="relative flex h-3.5 w-3.5 items-center justify-center">
                {active && (
                  <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
                )}
                <span
                  className={`relative h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
                    active ? "bg-accent" : "bg-text-4"
                  }`}
                />
              </span>
            ) : (
              <Icon size={13} aria-hidden strokeWidth={active ? 2.2 : 1.8} />
            )}
            <span className="max-sm:sr-only">{t(env)}</span>
          </button>
        );
      })}
    </div>
  );
}
