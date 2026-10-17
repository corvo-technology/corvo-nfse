"use client";

import { useState } from "react";

/** Small copy button for a standalone code block (a prompt, a command). */
export function CopyCodeButton({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the text stays selectable on the page.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text"
    >
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}
