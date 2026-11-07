"use client";
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 600;

/**
 * A number that glides to its new value instead of jumping, so a counter that moves is noticed.
 * The first render shows the value as is; `prefers-reduced-motion` skips the glide.
 */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = current.current;
    if (reduce || from === target) { current.current = target; setShown(target); return; }
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / DURATION_MS);
      const value = progress >= 1 ? target : Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      current.current = value; setShown(value);
      frame.current = progress >= 1 ? null : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [target]);

  return shown;
}
