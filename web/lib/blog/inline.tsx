import Link from "next/link";
import type { ReactNode } from "react";

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

const CODE_CLASS = "rounded bg-surface px-1 py-0.5 font-mono text-[0.86em] text-accent";
const LINK_CLASS =
  "text-text underline decoration-accent-border underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent";

/** Renders `code`, **bold** and [label](href). Anything else is plain text, never HTML. */
export function Inline({ text }: { text: string }): ReactNode {
  return text.split(TOKEN).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className={CODE_CLASS}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-text">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const link = LINK.exec(part);
    if (link) {
      const [, label, href] = link;
      return href.startsWith("/") ? (
        <Link key={index} href={href} className={LINK_CLASS}>
          {label}
        </Link>
      ) : (
        <a key={index} href={href} rel="noopener" className={LINK_CLASS}>
          {label}
        </a>
      );
    }
    return part;
  });
}

/** The same text without markers, for word counts, JSON-LD, RSS and llms files. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
