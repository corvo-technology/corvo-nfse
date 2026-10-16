// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import McpAuthorizePage from "@/app/mcp/authorize/page";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const QUERY = "client_id=corvo-mcp-abc12345&redirect_uri=http%3A%2F%2Flocalhost%3A7001%2Fcallback&scope=nfse%3Aread+nfse%3Awrite&state=st&code_challenge=ch&code_challenge_method=S256";
const mocks = vi.hoisted(() => ({
  consentContext: vi.fn(),
  decide: vi.fn(),
  replace: vi.fn(),
  status: "authenticated" as "authenticated" | "anonymous" | "loading",
  query: "",
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  mcp: { consentContext: mocks.consentContext, decide: mocks.decide },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ status: mocks.status, tenantId: "t-1" }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ replace: mocks.replace }),
}));

const context = {
  client: { id: "corvo-mcp-abc12345", name: "Claude Code" },
  redirect_host: "localhost:7001",
  scopes: [{ name: "nfse:read", description: "Read" }, { name: "nfse:write", description: "Write" }],
  tenants: [
    { id: "t-1", name: "Acme", allowed_scopes: ["nfse:read", "nfse:write"] },
    { id: "t-2", name: "Billing only", allowed_scopes: ["nfse:read"] },
  ],
};
const assign = vi.fn();
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><McpAuthorizePage /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = "authenticated";
  mocks.query = QUERY;
  mocks.consentContext.mockResolvedValue(context);
  Object.defineProperty(window, "location", { configurable: true, value: { assign } });
});
afterEach(cleanup);

describe("MCP authorize screen", () => {
  it("sends a logged-out user to login and back to this exact URL", async () => {
    mocks.status = "anonymous";
    renderPage();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    const target = String(mocks.replace.mock.calls[0][0]);
    expect(target.startsWith("/login?mode=login&next=")).toBe(true);
    expect(decodeURIComponent(target.split("next=")[1])).toBe(`/mcp/authorize?${QUERY}`);
    expect(mocks.consentContext).not.toHaveBeenCalled();
  });

  it("shows the app, what it can do and only offers workspaces the user can grant", async () => {
    renderPage();
    await screen.findByText("Claude Code wants to access your Corvo account");
    expect(screen.getByText("Query and download invoices")).toBeTruthy();
    expect(screen.getByText("Issue invoices")).toBeTruthy();
    expect((screen.getByLabelText("Acme") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Billing only/) as HTMLInputElement).disabled).toBe(true);
  });

  it("allows with the chosen workspace and sends the browser back to the agent", async () => {
    mocks.decide.mockResolvedValue({ redirect_url: "http://localhost:7001/callback?code=c1&state=st" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://localhost:7001/callback?code=c1&state=st"));
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ client_id: "corvo-mcp-abc12345", state: "st" }), "allow", "t-1", "test");
    await screen.findByText("Connected!");
  });

  it("starts on test and sends production only when the user picks it", async () => {
    mocks.decide.mockResolvedValue({ redirect_url: "http://localhost:7001/callback?code=c1&state=st" });
    renderPage();
    expect((await screen.findByLabelText(/^Test/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Production/));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(expect.anything(), "allow", "t-1", "live"));
  });

  it("denies without a workspace and shows the denied state", async () => {
    mocks.decide.mockResolvedValue({ redirect_url: "http://localhost:7001/callback?error=access_denied&state=st" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await screen.findByText("Access denied");
    expect(mocks.decide).toHaveBeenCalledWith(expect.anything(), "deny", undefined, undefined);
  });

  it("shows an invalid-link message when the parameters are missing or rejected", async () => {
    mocks.query = "client_id=corvo-mcp";
    renderPage();
    await screen.findByText(/Invalid or expired authorization link/);
    expect(mocks.consentContext).not.toHaveBeenCalled();

    cleanup();
    mocks.query = QUERY;
    mocks.consentContext.mockRejectedValue(new ApiError(400, "bad"));
    renderPage();
    await screen.findByText(/Invalid or expired authorization link/);
  });

  it("keeps the screen open and explains when the API refuses the grant", async () => {
    mocks.decide.mockRejectedValue(new ApiError(403, "no"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await screen.findByText("Your role in this workspace cannot grant these permissions.");
    expect(assign).not.toHaveBeenCalled();
  });
});
