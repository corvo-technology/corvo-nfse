/** A small faceted shard cut from the Corvo mark. It replaces icon tiles and bullets on the landing. */
export function Facet({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-[9px] w-[13px] shrink-0 bg-accent [clip-path:polygon(0_100%,18%_8%,100%_0,58%_100%)] ${className}`}
    />
  );
}
