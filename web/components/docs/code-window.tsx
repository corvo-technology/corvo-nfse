// components/docs/code-window.tsx
"use client";
import { useState } from "react";

type Tab = "curl" | "node";

export function CodeWindow({
  curl,
  node,
  copyLabel,
  copiedLabel,
}: {
  curl: string;
  node: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [tab, setTab] = useState<Tab>("curl");
  const [copied, setCopied] = useState(false);
  const code = tab === "curl" ? curl : node;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs font-mono transition-colors ${
      active ? "bg-surface-alt text-text" : "text-text-4 hover:text-text-2"
    }`;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-danger" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-warn" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-ok" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Example language">
          <button type="button" role="tab" aria-selected={tab === "curl"} onClick={() => setTab("curl")} className={tabClass(tab === "curl")}>
            cURL
          </button>
          <button type="button" role="tab" aria-selected={tab === "node"} onClick={() => setTab("node")} className={tabClass(tab === "node")}>
            JavaScript
          </button>
        </div>
        <button
          type="button"
          onClick={copy}
          className="rounded-md px-2 py-1 text-xs text-text-4 transition-colors hover:text-text-2"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-text-2">
        <code>{code}</code>
      </pre>
    </div>
  );
}
