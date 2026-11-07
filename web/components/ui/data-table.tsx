"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Mobile card: shown as the card title (no label). One per table. */
  primary?: boolean;
  /** Mobile card: shown at the bottom right, without a label (row actions). */
  action?: boolean;
  /** Hide this column in the mobile card layout. */
  hideOnMobile?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table (visually hidden). */
  caption: string;
  className?: string;
  /** Extra class for one row (a marker, a flash). */
  rowClassName?: (row: T) => string | undefined;
  /** Key of the row that shows `renderExpanded` right under it (for example an inline editor). */
  expandedKey?: string | null;
  renderExpanded?: (row: T) => ReactNode;
}

/** True from the md breakpoint up (and where the browser cannot tell, such as during tests). */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/**
 * Table on md+, stacked cards below. Both share the same column definitions,
 * so adding a column keeps desktop and mobile in sync.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, className, rowClassName, expandedKey, renderExpanded }: DataTableProps<T>) {
  // The expanded content must exist once, so it goes in the layout that is on screen.
  const desktop = useIsDesktop();
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const actions = columns.filter((c) => c.action);
  const details = columns.filter((c) => c !== primary && !c.action && !c.hideOnMobile);

  return (
    <div className={className}>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    "px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.07em] text-text-4 first:pl-5 last:pr-5",
                    c.align === "right" ? "text-right" : "text-left"
                  )}
                >
                  {c.action ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={rowKey(row)}>
                <tr className={cn("row-hover border-t border-border text-[13.5px] text-text", rowClassName?.(row))}>
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-4 py-3.5 align-middle first:pl-5 last:pr-5",
                        c.align === "right" && "text-right",
                        c.className
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
                {desktop && renderExpanded && expandedKey === rowKey(row) && (
                  <tr><td colSpan={columns.length} className="border-t border-border bg-active/40 p-4 sm:px-5">{renderExpanded(row)}</td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y divide-border md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className={cn("flex flex-col gap-3 px-4 py-4", rowClassName?.(row))}>
            <div className="min-w-0 text-[14px] font-medium text-text">{primary.cell(row)}</div>
            {details.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
                {details.map((c) => (
                  <div key={c.id} className="contents">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-4">{c.header}</dt>
                    <dd className="min-w-0 justify-self-end text-right text-text-2">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions.length > 0 && (
              <div className="flex items-center justify-end gap-2">{actions.map((c) => <span key={c.id}>{c.cell(row)}</span>)}</div>
            )}
            {!desktop && renderExpanded && expandedKey === rowKey(row) && <div className="border-t border-border pt-3">{renderExpanded(row)}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Loading placeholder with the same silhouette as DataTable. */
export function DataTableSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="skeleton h-4 w-1/4" />
          <div className="skeleton h-4 flex-1" />
          <div className="skeleton hidden h-4 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}
