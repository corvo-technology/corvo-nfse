import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("flex flex-col items-center gap-3 px-6 py-14 text-center", className)}
    >
      {Icon && (
        <span
          aria-hidden
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border",
            tone === "danger" ? "border-danger-border bg-danger-surface text-danger" : "border-border-strong bg-white/[0.03] text-text-3"
          )}
        >
          <Icon size={18} />
        </span>
      )}
      <p className={cn("text-[14.5px] font-medium", tone === "danger" ? "text-danger" : "text-text")}>{title}</p>
      {description && <p className="max-w-[360px] text-[13px] text-text-3">{description}</p>}
      {action}
    </div>
  );
}
