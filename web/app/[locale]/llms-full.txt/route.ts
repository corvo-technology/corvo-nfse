import { notFound } from "next/navigation";
import { buildLlmsFull, markdownResponse } from "@/lib/llms";
import { isSeoLocale } from "@/lib/seo";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "pt" }];
}

/** /pt/llms-full.txt and /en/llms-full.txt, generated from the docs registry. */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSeoLocale(locale)) notFound();
  return markdownResponse(buildLlmsFull(locale));
}
