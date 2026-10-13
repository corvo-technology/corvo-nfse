"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Switch with a real <label>; the label text is the accessible name. */
function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-[24px] w-[42px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-accent" : "bg-[#2a2a2a]"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block h-[18px] w-[18px] rounded-full shadow-sm transition-transform duration-200",
            checked ? "translate-x-[21px] bg-bg" : "translate-x-[3px] bg-text-3"
          )}
        />
      </button>
      <div className="flex flex-col gap-0.5">
        <span id={`${id}-label`} className="text-[13.5px] leading-tight text-text">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="text-[12px] leading-tight text-text-4">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}

export { Toggle, type ToggleProps };
