// components/docs/doc-blocks.tsx
import type { DocBlock, DocsChrome } from "@/lib/docs/types";
import { Callout } from "./callout";
import { EndpointCard } from "./endpoint-card";
import { CopyCodeButton } from "./copy-code-button";
import { InlineText } from "./inline-text";

const CODE_BLOCK_LANG_LABEL = { bash: "bash", json: "json", js: "javascript", text: "prompt" } as const;

export function DocBlocks({
  blocks,
  copy,
}: {
  blocks: DocBlock[];
  copy: DocsChrome["copy"];
}) {
  return (
    <div className="space-y-6">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return block.level === 2 ? (
              <h2 key={i} className="pt-4 text-xl font-semibold text-text">
                <InlineText body={block.body} />
              </h2>
            ) : (
              <h3 key={i} className="pt-2 text-lg font-medium text-text">
                <InlineText body={block.body} />
              </h3>
            );
          case "text":
            return (
              <p key={i} className="text-sm leading-relaxed text-text-2">
                <InlineText body={block.body} />
              </p>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm text-text-2">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <InlineText body={item} />
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface">
                    <tr className="text-text-3">
                      {block.head.map((h, j) => (
                        <th key={j} className="p-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-t border-border align-top">
                        {row.map((cell, k) => (
                          <td key={k} className="p-3 text-text-2">
                            <InlineText body={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "callout":
            return <Callout key={i} tone={block.tone} body={block.body} />;
          case "code":
            return (
              <div key={i}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-wide text-text-4">
                    {block.label ?? CODE_BLOCK_LANG_LABEL[block.language]}
                  </p>
                  <CopyCodeButton code={block.code} copyLabel={copy.copy} copiedLabel={copy.copied} />
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text-2">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          case "endpoint":
            return <EndpointCard key={i} block={block} copy={copy} />;
        }
      })}
    </div>
  );
}
