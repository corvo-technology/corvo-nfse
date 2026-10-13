import Link from "next/link";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

export function DocsHeader({
  locale,
  slug,
  localeSwitch,
}: {
  locale: string;
  slug: string | null;
  localeSwitch: Record<string, string>;
}) {
  const other = locale === "en" ? "pt" : "en";
  const path = slug ? `/docs/${slug}` : "/docs";
  return (
    <header className="mb-8 flex items-center justify-between border-b border-border pb-4">
      <div className="flex items-center gap-4">
        <Link href={`/${locale}`}>
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-4">
          <span>docs</span>
          <span className="mx-1.5">/</span>
          <span className="text-text-2">{slug ? slug : "intro"}</span>
        </nav>
      </div>
      <Link
        href={`/${other}${path}`}
        className="rounded-md border border-border px-2 py-1 text-xs text-text-3 transition-colors hover:text-text"
      >
        {localeSwitch[other]}
      </Link>
    </header>
  );
}
