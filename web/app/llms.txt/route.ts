import { buildLlmsTxt, markdownResponse } from "@/lib/llms";

export const dynamic = "force-static";

/** English index for LLM tools (llmstxt.org). The Portuguese one is at /pt/llms.txt. */
export function GET() {
  return markdownResponse(buildLlmsTxt("en"));
}
