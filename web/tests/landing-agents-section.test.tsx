// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsSection, Conversation } from "@/components/landing/agents-section";
import { MCP_SERVER_URL } from "@/lib/mcp-config";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const renderSection = (locale: "en" | "pt" = "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : pt}>
      <AgentsSection />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  // Everything is "in view" and the user prefers reduced motion, so the scripted chat renders at once.
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("landing AI agents section", () => {
  it("sells the idea and shows the REST call the agent makes under the hood", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "Your AI agents can issue invoices." })).toBeTruthy();
    expect(screen.getByText("POST /v1/invoices")).toBeTruthy();
    expect(screen.queryByText("company_list")).toBeNull();
  });

  it("the scripted Claude Code conversation (shown in the hero) runs both tool calls and authorizes", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Conversation />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("company_list")).toBeTruthy();
    expect(screen.getByText("nfse_issue")).toBeTruthy();
    expect(await screen.findByText("Authorized")).toBeTruthy();
  });

  it("copies the one-line connect command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`claude mcp add --transport http corvo ${MCP_SERVER_URL}`));
    expect(await screen.findByRole("button", { name: /Copied/ })).toBeTruthy();
  });

  it("links to the MCP guide in the current language and lists the compatible agents", () => {
    renderSection("pt");
    expect(screen.getByRole("link", { name: /Ver o guia de MCP/ }).getAttribute("href")).toMatch(/\/docs\/mcp$/);
    for (const name of ["Claude Code", "Cursor", "Codex", "Windsurf"]) expect(screen.getByText(name)).toBeTruthy();
  });
});
