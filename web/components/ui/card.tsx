import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "accent";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  default: "border border-border bg-surface",
  accent: "border border-accent-border bg-accent-surface",
};

function Card({ variant = "default", className, children, ...props }: CardProps) {
  return (
    <div className={cn("rounded-[12px]", variantStyles[variant], className)} {...props}>
      {children}
    </div>
  );
}

export { Card, type CardProps, type CardVariant };
