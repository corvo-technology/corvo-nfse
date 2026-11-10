import { Inline } from "@/lib/blog/inline";

/**
 * Direct answer at the top of every post, on a sheet of the brand's "paper" color with a torn edge.
 * It is real text in the first screen, which is what search snippets and AI answers quote.
 */
export function AnswerBox({ text }: { text: string }) {
  return (
    <aside aria-labelledby="resposta-rapida" className="mt-8">
      <div className="rounded-t-[6px] bg-paper px-5 pb-5 pt-4 text-ink sm:px-6">
        <p id="resposta-rapida" className="border-b border-dashed border-paper-edge pb-3 text-[13px] font-semibold text-ink-2">
          Resposta rápida
        </p>
        <p className="mt-3 text-[16.5px] leading-[1.65] text-pretty [&_code]:bg-paper-edge/60 [&_code]:text-ink [&_strong]:text-ink">
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
