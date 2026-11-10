import { Inline } from "@/lib/blog/inline";
import { slugifyHeading } from "@/lib/blog/registry";
import type { BlogBlock } from "@/lib/blog/types";

function CodeBlock({ label, language, code }: { label?: string; language: string; code: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 font-mono text-[11px] text-text-4">
        <span className="truncate">{label ?? language}</span>
        <span className="uppercase tracking-[0.08em]">{language}</span>
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-[1.7] text-text-2">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-left text-[14.5px] leading-[1.55]">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-border bg-surface-alt px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-text-3"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border-soft last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-2.5 align-top text-text-2">
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders the post body. Spacing between blocks comes from the parent's `space-y`. */
export function PostBody({ blocks }: { blocks: BlogBlock[] }) {
  // Number of each h2 (1-based), computed up front so rendering stays pure.
  const sectionNumber = new Map<number, number>();
  blocks.forEach((block, index) => {
    if (block.kind === "h2") sectionNumber.set(index, sectionNumber.size + 1);
  });
  return (
    <div className="space-y-5 text-[17px] leading-[1.75] text-text-2">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "p":
            return (
              <p key={index}>
                <Inline text={block.text} />
              </p>
            );
          case "h2": {
            return (
              <h2
                key={index}
                id={slugifyHeading(block.text)}
                className="!mt-14 scroll-mt-24 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-text sm:text-[30px]"
              >
                <span aria-hidden="true" className="mb-2 block font-mono text-[12px] font-normal tracking-[0.08em] text-accent">
                  {String(sectionNumber.get(index)).padStart(2, "0")}
                </span>
                <Inline text={block.text} />
              </h2>
            );
          }
          case "h3":
            return (
              <h3
                key={index}
                id={slugifyHeading(block.text)}
                className="!mt-9 scroll-mt-24 text-[19px] font-semibold leading-[1.35] tracking-[-0.01em] text-text"
              >
                <Inline text={block.text} />
              </h3>
            );
          case "ul":
            return (
              <ul key={index} className="list-disc space-y-2 pl-6 marker:text-accent-border">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={index} className="list-decimal space-y-2 pl-6 marker:font-mono marker:text-accent">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            );
          case "table":
            return <Table key={index} head={block.head} rows={block.rows} />;
          case "code":
            return <CodeBlock key={index} label={block.label} language={block.language} code={block.code} />;
          case "callout":
            return (
              <p
                key={index}
                className={`banner ${block.tone === "warn" ? "banner-warn" : "banner-accent"} !text-[15px] leading-[1.65]`}
              >
                <span className="min-w-0 flex-1">
                  <Inline text={block.text} />
                </span>
              </p>
            );
        }
      })}
    </div>
  );
}
