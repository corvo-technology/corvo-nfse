"use client";

import { useEffect } from "react";

const HIGHLIGHT = ["ring-2", "ring-accent/70", "transition-shadow", "duration-700"];
const HIGHLIGHT_MS = 2000;

/**
 * Pages load their data after render, so the browser cannot jump to #id by itself.
 * When the URL hash matches `id` (and `ready`), scrolls to the element and gives it a ring that fades after ~2s.
 */
export function useScrollToHash(id: string, ready = true): void {
  useEffect(() => {
    if (!ready || window.location.hash !== `#${id}`) return;
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    element.classList.add(...HIGHLIGHT);
    const timer = setTimeout(() => element.classList.remove(...HIGHLIGHT), HIGHLIGHT_MS);
    return () => { clearTimeout(timer); element.classList.remove(...HIGHLIGHT); };
  }, [id, ready]);
}
