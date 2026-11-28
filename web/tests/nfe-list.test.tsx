// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NfeListPage from "@/app/(dashboard)/app/nfe/page";
import type { NfeDocument } from "@/lib/nfe";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ environment: "test" as "test" | "live", nfeProduction: false, list: vi.fn(), permissions: new Set<string>() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => mocks.permissions.has(permission), fiscalEnvironment: mocks.environment, features: { nfeProduction: mocks.nfeProduction } }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { list: async () => ({ items: [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }], hasMore: false, nextCursor: null }) },
}));
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), listNfe: mocks.list }));

const nfe = (over: Partial<NfeDocument> = {}) => ({
  type: "nfe", id: "n1", companyId: "c1", environment: "test", status: "authorized", series: 1, number: 12, accessKey: null, issuedAt: null, authorizedAt: null, protocol: null, cStat: null, xMotivo: null,
  cancelReason: null, cancelRequestedAt: null, natOp: "Venda", recipient: { name: "Maria da Silva", taxId: "12345678909" }, items: [], totals: { vNF: "20.00" },
  lastError: null, createdAt: "2026-11-26T12:00:00.000Z", ...over,
}) as unknown as NfeDocument;

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><NfeListPage /></NextIntlClientProvider>);

beforeEach(() => {
  mocks.permissions = new Set(["nfe.documents.view", "nfe.documents.issue"]);
  mocks.environment = "test";
  mocks.nfeProduction = false;
  mocks.list.mockReset();
  mocks.list.mockResolvedValue({ items: [nfe(), nfe({ id: "n2", status: "rejected", recipient: { name: "João", taxId: "1" } as never, lastError: { type: "validation", code: "X", message: "NCM invalid" } })], hasMore: true, nextCursor: "next" });
});
afterEach(cleanup);

describe("NF-e list", () => {
  it("shows the notice for the environment: test, production off, production on", async () => {
    const { unmount } = renderPage();
    expect(await screen.findByText(messages.Nfe.homologationNotice)).toBeTruthy();
    unmount();
    mocks.environment = "live";
    const second = renderPage();
    expect(await screen.findByText(messages.Nfe.form.productionLocked)).toBeTruthy();
    expect(screen.queryByText(messages.Nfe.homologationNotice)).toBeNull();
    second.unmount();
    mocks.nfeProduction = true;
    renderPage();
    expect(await screen.findByText(messages.Nfe.liveNotice)).toBeTruthy();
    expect(screen.queryByText(messages.Nfe.homologationNotice)).toBeNull();
  });

  it("lists the notes with number, amount and state, linking each to its page", async () => {
    renderPage();
    const link = (await screen.findAllByRole("link", { name: "Maria da Silva" }))[0];
    expect(link.getAttribute("href")).toBe("/app/nfe/n1");
    expect(screen.getAllByText("Authorized").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NCM invalid").length).toBeGreaterThan(0);
  });

  it("each row has a Copy link to the form filled from the note; without permission to issue there is none", async () => {
    renderPage();
    const links = await screen.findAllByRole("link", { name: "Copy Maria da Silva" });
    expect(links[0].getAttribute("href")).toBe("/app/nfe/new?from=n1");
    expect((await screen.findAllByRole("link", { name: "Copy João" }))[0].getAttribute("href")).toBe("/app/nfe/new?from=n2");
    cleanup();
    mocks.permissions = new Set(["nfe.documents.view"]);
    renderPage();
    await screen.findAllByRole("link", { name: "Maria da Silva" });
    expect(screen.queryByRole("link", { name: /^Copy / })).toBeNull();
  });

  it("filters by company and by state on the API, from the first page", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Maria da Silva" });
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, type: "nfe" }, expect.anything());
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "rejected" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, type: "nfe", status: "rejected" }, expect.anything()));
    await screen.findByRole("option", { name: "Acme" });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "c1" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, type: "nfe", companyId: "c1", status: "rejected" }, expect.anything()));
  });

  it("loads the next page with the cursor", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Maria da Silva" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, cursor: "next", type: "nfe" }, undefined));
  });

  it("says plainly that NF-e is in test mode and does not calculate taxes", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Maria da Silva" });
    expect(screen.getByRole("note").textContent).toMatch(/test mode/);
    expect(screen.getByRole("note").textContent).toMatch(/does not calculate taxes/);
  });

  it("offers 'New NF-e' only to who may issue", async () => {
    renderPage();
    await screen.findAllByRole("link", { name: "Maria da Silva" });
    expect(screen.getByRole("link", { name: /New NF-e/ }).getAttribute("href")).toBe("/app/nfe/new");
    cleanup();
    mocks.permissions = new Set(["nfe.documents.view"]);
    renderPage();
    await screen.findAllByRole("link", { name: "Maria da Silva" });
    expect(screen.queryByRole("link", { name: /New NF-e/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Skipped numbers/ }).getAttribute("href")).toBe("/app/nfe/number-gaps");
  });

  it("shows an empty state and a load error", async () => {
    mocks.list.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    renderPage();
    await screen.findByText("No NF-e here yet.");
    cleanup();
    mocks.list.mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByText("Could not load the notes. Try again.");
  });

  it("filters by model and shows the model of each row, with nothing to release", async () => {
    mocks.list.mockResolvedValue({ items: [nfe({ id: "n3", type: "nfce", recipient: null as never })], hasMore: false, nextCursor: null });
    renderPage();
    await screen.findAllByText("Consumer not identified");
    expect(screen.getAllByText("NFC-e").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "nfce" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, type: "nfce" }, expect.anything()));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "nfe" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, type: "nfe" }, expect.anything()));
  });
});
