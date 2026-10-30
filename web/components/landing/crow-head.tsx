"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

const ENTER = { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const };

/**
 * The brand mark, drawn large and flipped to face the headline. Its two facets and the eye are
 * separate layers: they slide into place on load, then drift by different amounts with a fine
 * pointer, so the still mark gains depth. Transform only; none of it runs with reduced motion.
 */
export function CrowHead({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const nx = useMotionValue(0);
  const ny = useMotionValue(0);
  const x = useSpring(nx, { stiffness: 110, damping: 18, mass: 0.6 });
  const y = useSpring(ny, { stiffness: 110, damping: 18, mass: 0.6 });

  // The svg is mirrored with scale-x-[-1], so horizontal drift is negated to follow the pointer.
  const headX = useTransform(x, (v) => -v * 1.0);
  const headY = useTransform(y, (v) => v * 0.7);
  const beakX = useTransform(x, (v) => -v * 2.2);
  const beakY = useTransform(y, (v) => v * 1.5);
  const eyeX = useTransform(x, (v) => -v * 3.2);
  const eyeY = useTransform(y, (v) => v * 2.1);

  useEffect(() => {
    if (reduce || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const onMove = (event: PointerEvent) => {
      nx.set(event.clientX / window.innerWidth - 0.5);
      ny.set(event.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, nx, ny]);

  const enter = (from: { x: number; y: number }, delay: number) =>
    reduce
      ? {}
      : { initial: { x: from.x, y: from.y }, animate: { x: 0, y: 0 }, transition: { ...ENTER, delay } };

  return (
    <svg aria-hidden viewBox="14 13 50 37" className={className}>
      <motion.g {...enter({ x: 5, y: 3 }, 0.05)}>
        <motion.path d="M39 16L45 25L61 26L45 30L41 44L20 47Z" fill="#3fd6a8" fillOpacity={0.55} style={{ x: beakX, y: beakY }} />
      </motion.g>
      <motion.g {...enter({ x: -4, y: 2 }, 0.15)}>
        <motion.path d="M17 44L21 21L39 16L45 25L20 47Z" fill="#3fd6a8" style={{ x: headX, y: headY }} />
      </motion.g>
      <motion.g {...enter({ x: 0, y: 0 }, 0.4)}>
        <motion.circle
          cx="33"
          cy="24.5"
          r="2.4"
          fill="#0a0a0a"
          style={{ x: eyeX, y: eyeY, transformBox: "fill-box", transformOrigin: "center" }}
          {...(reduce ? {} : { initial: { scale: 0.3 }, animate: { scale: 1 }, transition: { ...ENTER, delay: 0.4 } })}
        />
      </motion.g>
    </svg>
  );
}
