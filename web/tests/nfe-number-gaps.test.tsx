// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NfeNumberGapsPage from "@/app/(dashboard)/app/nfe/number-gaps/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ gaps: vi.fn(), requests: vi.fn(), inutilize: vi.fn(), permissions: new Set<string>() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => mocks.permissions.has(permission) }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { list: async () => ({ items: [{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }], hasMore: false, nextCursor: null }) },
}));
vi.mock("@/lib/nfe", async (original) => ({ ...(await original<typeof import("@/lib/nfe")>()), listNumberGaps: mocks.gaps, listInutilizations: mocks.requests, createInutilization: mocks.inutilize }));

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><NfeNumberGapsPage /></NextIntlClientProvider>);

beforeEach(() => {
  mocks.permissions = new Set(["nfe.documents.view", "nfe.documents.manage"]);
  mocks.gaps.mockReset(); mocks.requests.mockReset(); mocks.inutilize.mockReset();
  mocks.gaps.mockResolvedValue([{ companyId: "c1", series: 1, start: 3, end: 5 }, { companyId: "c1", series: 1, start: 9, end: 9 }]);
  mocks.requests.mockResolvedValue({ items: [{ id: "i1", companyId: "c1", series: 1, start: 1, end: 2, status: "homologada" }], hasMore: false, nextCursor: null });
  mocks.inutilize.mockResolvedValue({ id: "i2" });
});
afterEach(cleanup);

describe("NF-e skipped numbers", () => {
  it("lists the gaps per company and series, and the earlier requests", async () => {
    renderPage();
    await screen.findByText("Series 1 · numbers 3 – 5");
    expect(screen.getByText("Series 1 · numbers 9")).toBeTruthy();
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getByText("Accepted by the SEFAZ")).toBeTruthy();
  });

  it("the justification dialog needs 15 characters and then asks the API for that exact range", async () => {
    renderPage();
    await screen.findByText("Series 1 · numbers 3 – 5");
    fireEvent.click(screen.getAllByRole("button", { name: "Inutilize range" })[0]);
    const dialog = await screen.findByRole("dialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Inutilize")!;
    fireEvent.change(screen.getByLabelText(/Why these numbers will not be used/), { target: { value: "muito curto" } });
    fireEvent.click(confirm);
    await screen.findByText("The text must have 15 to 255 characters.");
    expect(mocks.inutilize).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Why these numbers will not be used/), { target: { value: "Numeração pulada por falha do sistema" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.inutilize).toHaveBeenCalledWith({ companyId: "c1", series: 1, start: 3, end: 5, justification: "Numeração pulada por falha do sistema" }, expect.any(String)));
    await screen.findByText(/Inutilization request sent/);
  });

  it("without nfe.documents.manage there is no inutilize button", async () => {
    mocks.permissions = new Set(["nfe.documents.view"]);
    renderPage();
    await screen.findByText("Series 1 · numbers 3 – 5");
    expect(screen.queryByRole("button", { name: "Inutilize range" })).toBeNull();
  });

  it("says so when there are no gaps", async () => {
    mocks.gaps.mockResolvedValue([]);
    renderPage();
    await screen.findByText("No skipped numbers.");
  });
});
