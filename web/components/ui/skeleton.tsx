import { cn } from "@/lib/utils";

/** Decorative loading block. Announce loading state on the parent via aria-busy. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4 w-full", className)} />;
}
