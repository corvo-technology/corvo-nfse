// components/docs/endpoint-card.tsx
import type { DocsChrome, EndpointBlock } from "@/lib/docs/types";
import { Callout } from "./callout";
import { CodeWindow } from "./code-window";
import { InlineText } from "./inline-text";
import { ParamTable } from "./param-table";

const METHOD_CLASS: Record<EndpointBlock["method"], string> = {
  GET: "text-accent",
  POST: "text-accent",
  PATCH: "text-warn",
  DELETE: "text-danger",
};

const METHOD_BORDER: Record<EndpointBlock["method"], string> = {
  GET: "border-l-accent",
  POST: "border-l-accent",
  PATCH: "border-l-warn",
  DELETE: "border-l-danger",
};

export function EndpointCard({
  block,
  copy,
}: {
  block: EndpointBlock;
  copy: DocsChrome["copy"];
}) {
  return (
    <section
      className={`rounded-xl border border-border border-l-2 bg-surface-alt/40 p-5 ${METHOD_BORDER[block.method]}`}
      aria-label={`${block.method} ${block.path}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`font-mono text-sm font-semibold ${METHOD_CLASS[block.method]}`}>
          {block.method}
        </span>
        <code className="font-mono text-sm text-text">{block.path}</code>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-text-3">
          {block.success}
        </span>
      </header>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {block.scopes.map((scope) => (
          <span
            key={scope}
            className="rounded-md border border-accent-border bg-accent-surface px-1.5 py-0.5 font-mono text-[11px] text-accent"
          >
            {scope}
          </span>
        ))}
      </div>
      <p className="mt-3 text-sm text-text-2">
        <InlineText body={block.summary} />
      </p>
      {block.params && (
        <div className="mt-4">
          {block.params.title && (
            <h4 className="mb-2 text-sm font-medium text-text">{block.params.title}</h4>
          )}
          <ParamTable rows={block.params.rows} labels={copy.table} />
        </div>
      )}
      <div className="mt-4">
        <CodeWindow
          curl={block.examples.curl}
          node={block.examples.node}
          copyLabel={copy.copy}
          copiedLabel={copy.copied}
        />
      </div>
      {block.response.json.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wide text-text-4">
            {copy.response} — <span>{block.response.label}</span>
          </p>
          <pre className="overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text-2">
            <code>{block.response.json}</code>
          </pre>
        </div>
      )}
      {block.notes?.map((note, i) => (
        <div key={i} className="mt-3">
          <Callout tone={note.tone} body={note.body} />
        </div>
      ))}
    </section>
  );
}
