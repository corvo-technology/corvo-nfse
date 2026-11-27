// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuditPage from "@/app/(dashboard)/app/settings/audit/page";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import type { AuditEvent } from "@/lib/audit";
import messages from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ list: vi.fn(), canManage: true, pathname: "/app/settings/audit" }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  auditEvents: { list: mocks.list },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => permission === "settings.manage" && mocks.canManage }) }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

const NOW = new Date("2026-11-24T15:00:00.000Z");
const event = (over: Partial<AuditEvent> & Pick<AuditEvent, "id" | "action">): AuditEvent => ({
  occurredAt: "2026-11-24T09:00:00.000Z",
  environment: null,
  actor: { type: "user", label: "Pedro Henrique", onBehalfOf: null },
  target: { type: null, id: null, label: null },
  metadata: {},
  ...over,
});
const page = (items: AuditEvent[], nextCursor: string | null = null) => ({ items, hasMore: nextCursor !== null, nextCursor });
const table = () => screen.findByRole("table");
const inTable = async (text: string) => within(await table()).findByText(text);
const renderPage = () => render(<NextIntlClientProvider locale="pt" messages={messages}><AuditPage /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.canManage = true;
  mocks.pathname = "/app/settings/audit";
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Settings audit tab", () => {

  it("does not show the load error when an earlier request was cancelled and the new one worked", async () => {
    let calls = 0;
    mocks.list.mockImplementation((_params: unknown, signal: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return Promise.resolve(page([event({ id: "1", action: "invoice.issued", target: { type: "invoice", id: "i", label: "NFS-e 12" } })]));
    });
    render(<StrictMode><NextIntlClientProvider locale="pt" messages={messages}><AuditPage /></NextIntlClientProvider></StrictMode>);
    expect(await inTable("NFS-e 12")).toBeTruthy();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(messages.Audit.error)).toBeNull();
  });
  it("lists who did what and when, in the reference format", async () => {
    mocks.list.mockResolvedValue(page([
      event({ id: "1", action: "invoice.issued", occurredAt: "2026-11-24T09:00:00.000Z", target: { type: "invoice", id: "i", label: "NFS-e 12" } }),
      event({ id: "2", action: "invoice.issued", actor: { type: "agent", label: "Claude", onBehalfOf: "Pedro" }, target: { type: "invoice", id: "j", label: "NFS-e 13" } }),
      event({ id: "3", action: "billing.payment_confirmed", actor: { type: "system", label: "Sistema", onBehalfOf: null }, target: { type: "payment", id: "p", label: null }, metadata: { method: "pix", units: 50 } }),
    ]));
    renderPage();
    expect(await inTable("Pedro Henrique")).toBeTruthy();
    expect(within(await table()).getAllByText("há 6 h").length).toBe(3);
    expect(within(screen.getByRole("table")).getAllByText("Emitiu nota").length).toBe(2);
    expect(within(screen.getByRole("table")).getByText("NFS-e 12")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Claude")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Agente")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("· Pedro")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Sistema")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Pagamento confirmado")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Pix · 50 créditos")).toBeTruthy();
  });

  it("shows the exact date on hover", async () => {
    mocks.list.mockResolvedValue(page([event({ id: "1", action: "api_key.created", target: { type: "api_key", id: "k", label: "rookbox" } })]));
    renderPage();
    const when = await inTable("há 6 h");
    expect(when.getAttribute("title")).toMatch(/24\/11\/2026/);
  });

  it("filters by agents and by period", async () => {
    mocks.list.mockResolvedValue(page([]));
    renderPage();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Quem"), { target: { value: "agent" } });
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "d7" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorType: "agent", from: new Date("2026-11-17T15:00:00.000Z").toISOString() }),
      expect.anything(),
    ));
  });

  it("loads more with the cursor", async () => {
    mocks.list
      .mockResolvedValueOnce(page([event({ id: "1", action: "company.created" })], "cur-1"))
      .mockResolvedValueOnce(page([event({ id: "2", action: "company.deleted" })]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await inTable("Excluiu empresa")).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cur-1" }), expect.anything());
    expect(within(screen.getByRole("table")).getByText("Criou empresa")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("shows an empty state and an error state", async () => {
    mocks.list.mockResolvedValueOnce(page([]));
    renderPage();
    expect(await screen.findByText("Nada registrado neste período.")).toBeTruthy();
    cleanup();
    mocks.list.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByText("Não foi possível carregar a auditoria.")).toBeTruthy();
  });

  it("hides the Auditoria tab without settings.manage", () => {
    mocks.canManage = false;
    render(<NextIntlClientProvider locale="pt" messages={messages}><SettingsTabs /></NextIntlClientProvider>);
    expect(screen.queryByRole("link", { name: "Auditoria" })).toBeNull();
    cleanup();
    mocks.canManage = true;
    render(<NextIntlClientProvider locale="pt" messages={messages}><SettingsTabs /></NextIntlClientProvider>);
    expect(screen.getByRole("link", { name: "Auditoria" }).getAttribute("href")).toBe("/app/settings/audit");
    expect(screen.getByRole("link", { name: "Geral" }).getAttribute("href")).toBe("/app/settings");
  });
});
