import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Page <h1> + subtitle + primary actions. Stacks on mobile, row on sm+. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="dash-in flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-text text-balance sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[56ch] text-[14.5px] text-text-3 text-pretty">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 [&>*]:flex-none max-sm:[&>a:only-child]:w-full max-sm:[&>button:only-child]:w-full">{actions}</div>}
    </header>
  );
}
