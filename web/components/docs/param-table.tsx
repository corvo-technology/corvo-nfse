// components/docs/param-table.tsx
import type { ParamRow } from "@/lib/docs/types";
import { InlineText } from "./inline-text";

export function ParamTable({
  rows,
  labels,
}: {
  rows: ParamRow[];
  labels: { field: string; type: string; required: string; description: string };
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface">
          <tr className="text-text-3">
            <th className="p-3 font-medium">{labels.field}</th>
            <th className="p-3 font-medium">{labels.type}</th>
            <th className="p-3 font-medium">{labels.required}</th>
            <th className="p-3 font-medium">{labels.description}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-border align-top">
              <td className="p-3 font-mono text-text">{row.name}</td>
              <td className="p-3 font-mono text-text-3">{row.type}</td>
              <td className="p-3 text-center">
                {row.required ? (
                  <span className="text-accent" aria-label={labels.required}>
                    ✓
                  </span>
                ) : (
                  <span className="text-text-5" aria-hidden="true">
                    —
                  </span>
                )}
              </td>
              <td className="p-3 text-text-2">
                <InlineText body={row.description} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
