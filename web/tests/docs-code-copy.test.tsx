// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocBlocks } from "@/components/docs/doc-blocks";
import { getDocsTree } from "@/lib/docs/registry";

afterEach(cleanup);

describe("docs code blocks", () => {
  it("copies the prompt of the AI integration page", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const tree = getDocsTree("en")!;
    const prompt = tree.pages.llms.blocks.find((block) => block.kind === "code");
    expect(prompt && prompt.kind === "code" && prompt.code).toContain("https://corvo.tech/llms-full.txt");

    render(<DocBlocks blocks={tree.pages.llms.blocks} copy={tree.chrome.copy} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("CORVO_API_KEY")));
    await screen.findByRole("button", { name: "Copied" });
  });

  it("never asks the agent to use a live key or to write the key in code", () => {
    for (const locale of ["en", "pt"]) {
      const block = getDocsTree(locale)!.pages.llms.blocks.find((item) => item.kind === "code");
      const code = block && block.kind === "code" ? block.code : "";
      expect(code).toContain("corvo_test_");
      expect(code).not.toContain("corvo_live_");
    }
  });
});
