// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentsPage from "@/app/app/agents/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ connections: vi.fn(), revoke: vi.fn(), success: vi.fn(), error: vi.fn(), admin: false }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  mcp: { connections: mocks.connections, revoke: mocks.revoke },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => permission === "settings.manage" && mocks.admin }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", tenant_id: "t1", tenant_name: "Acme", client_name: "Claude Code", scopes: ["nfse:read", "nfse:write"], granted_at: "2026-10-10T12:00:00.000Z",
  last_used_at: null, environment: "test", tool_calls: 12, invoices_issued: 3, revoked: false, mine: true, owner_email: "me@acme.test", ...over,
});
const page = (items: unknown[]) => ({ items, hasMore: false, nextCursor: null });
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><AgentsPage /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.admin = false; });
afterEach(cleanup);

describe("AI agents page", () => {
  it("shows the server URL and the first agent's instructions", async () => {
    mocks.connections.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No agent connected");
    expect(screen.getAllByText("https://api.corvo.tech/mcp").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Claude Code", selected: true })).toBeTruthy();
    expect(screen.getByText("claude mcp add --transport http corvo https://api.corvo.tech/mcp")).toBeTruthy();
    expect(screen.getByText(/you choose the environment/)).toBeTruthy();
  });

  it("switches the instructions when another agent is picked", async () => {
    mocks.connections.mockResolvedValue(page([]));
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Cursor" }));
    expect(screen.getByRole("tab", { name: "Cursor", selected: true })).toBeTruthy();
    expect(screen.getByText(".cursor/mcp.json")).toBeTruthy();
    expect(screen.getByText(/"mcpServers"/)).toBeTruthy();
    expect(screen.queryByText(/claude mcp add/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByText(/\[mcp_servers\.corvo\]/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Other" }));
    expect(screen.getByText(/Enter the server URL above/)).toBeTruthy();
  });

  it("moves between agents with the arrow keys", async () => {
    mocks.connections.mockResolvedValue(page([]));
    renderPage();
    fireEvent.keyDown(await screen.findByRole("tab", { name: "Claude Code" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Claude Desktop", selected: true })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Claude Desktop" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Claude Code", selected: true })).toBeTruthy();
  });

  it("lists connections with permissions, usage and never-used state", async () => {
    mocks.connections.mockResolvedValue(page([row()]));
    renderPage();
    const cells = await screen.findAllByText("Claude Code");
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.getAllByText("12 calls · 3 invoices issued").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Never used").length).toBeGreaterThan(0);
    // Permissions are compact chips; the full wording stays in the tooltip and for screen readers.
    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issue").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Query and download invoices").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Issue invoices").length).toBeGreaterThan(0);
  });

  it("pluralizes the usage line", async () => {
    mocks.connections.mockResolvedValue(page([row({ tool_calls: 1, invoices_issued: 1 })]));
    renderPage();
    expect((await screen.findAllByText("1 call · 1 invoice issued")).length).toBeGreaterThan(0);
  });

  it("marks production connections so they stand out", async () => {
    mocks.connections.mockResolvedValue(page([row({ environment: "live" })]));
    renderPage();
    expect((await screen.findAllByText("Production")).length).toBeGreaterThan(0);
  });

  it("revokes after confirmation and reloads the list", async () => {
    mocks.connections.mockResolvedValueOnce(page([row()])).mockResolvedValueOnce(page([row({ revoked: true })]));
    mocks.revoke.mockResolvedValue({ revoked: true });
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Revoke" }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/loses access right away/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Access revoked."));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull());
  });

  it("tells admins they see everyone's connections and who owns each one", async () => {
    mocks.admin = true;
    mocks.connections.mockResolvedValue(page([row({ id: "c2", mine: false, owner_email: "dev@acme.test" })]));
    renderPage();
    await screen.findByText("As an admin you can see and revoke every member's connections.");
    expect(screen.getAllByText(/by dev@acme\.test/).length).toBeGreaterThan(0);
  });

  it("shows a retryable error when the list cannot be loaded", async () => {
    mocks.connections.mockRejectedValue(new Error("down"));
    renderPage();
    await screen.findByText("Could not load the connections.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
