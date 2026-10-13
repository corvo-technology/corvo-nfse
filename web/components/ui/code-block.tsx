import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

function CodeBlock({ code, language, className }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "relative font-mono text-[12.5px] leading-[1.8] bg-surface border border-border rounded-[11px] p-5 overflow-x-auto",
        className
      )}
    >
      {language && (
        <span className="absolute top-3 right-4 text-[10px] font-mono text-text-5 uppercase tracking-wider select-none">
          {language}
        </span>
      )}
      <pre className="m-0 p-0 bg-transparent">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export { CodeBlock, type CodeBlockProps };
