import { buildLlmsFull, markdownResponse } from "@/lib/llms";

export const dynamic = "force-static";

/** The whole English documentation in one Markdown file, for LLM tools. */
export function GET() {
  return markdownResponse(buildLlmsFull("en"));
}
