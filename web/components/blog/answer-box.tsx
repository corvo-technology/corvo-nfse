import { Inline } from "@/lib/blog/inline";

/**
 * Direct answer at the top of every post, styled as a paper receipt (the brand "paper" tokens).
 * It is real text in the first screen, which is what search snippets and AI answers quote.
 */
export function AnswerBox({ text }: { text: string }) {
  return (
    <aside aria-labelledby="resposta-rapida" className="mt-8">
      <div className="rounded-t-[10px] bg-paper px-5 pb-4 pt-4 text-ink sm:px-6">
        <div className="flex items-center justify-between gap-4 border-b border-dashed border-paper-edge pb-3">
          <p id="resposta-rapida" className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-ink-2">
            Resposta rápida
          </p>
          <span
            aria-hidden="true"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 [border:1px_solid_currentColor] rounded-[3px] px-1.5 py-0.5"
          >
            NFS-e
          </span>
        </div>
        <p className="mt-3 text-[16.5px] leading-[1.65] [&_code]:bg-paper-edge/60 [&_code]:text-ink [&_strong]:text-ink">
          <Inline text={text} />
        </p>
      </div>
      <svg aria-hidden="true" width="100%" height="9" className="block fill-paper" preserveAspectRatio="none">
        <defs>
          <pattern id="receipt-teeth" width="16" height="9" patternUnits="userSpaceOnUse">
            <path d="M0 0 L8 9 L16 0 Z" />
          </pattern>
        </defs>
        <rect width="100%" height="9" fill="url(#receipt-teeth)" />
      </svg>
    </aside>
  );
}
