import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "accent" | "warn" | "danger" | "info" | "gray";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  accent: "text-accent bg-accent-surface border-accent-border",
  warn: "text-warn bg-warn/10 border-warn/20",
  danger: "text-danger bg-danger/10 border-danger/25",
  info: "text-info bg-info/10 border-info/20",
  gray: "text-text-2 bg-white/[0.04] border-border-strong",
};

function Badge({ variant = "gray", dot = true, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] leading-none",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export { Badge, type BadgeProps, type BadgeVariant };
