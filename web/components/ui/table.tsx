import type { HTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function TableHeader({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-3 text-left font-mono text-[11px] font-normal uppercase tracking-[0.07em] text-text-4",
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
}

function TableRow({ className, children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("row-hover border-t border-border text-[13.5px] text-text", className)} {...props}>
      {children}
    </tr>
  );
}

export { TableHeader, TableRow };
