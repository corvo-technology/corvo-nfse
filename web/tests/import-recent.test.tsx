// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecentImports } from "@/components/imports/recent-imports";
import type { ImportJob } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), imports: { list: mocks.list } }));

const job = (id: string, status: ImportJob["status"], counters: Partial<ImportJob["counters"]> = {}, fileName = `${id}.csv`): ImportJob => ({
  id, status, fileName, companyId: null, errorCode: null, rowsExpected: null, emitStartedAt: null, emitFinishedAt: null, createdAt: "2026-11-07T12:05:00.000Z",
  counters: { total: 300, valid: 0, invalid: 0, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 0, pending: 0, ...counters },
});
const show = () => render(<NextIntlClientProvider locale="en" messages={messages}><RecentImports /></NextIntlClientProvider>);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("RecentImports", () => {
  it("lists earlier imports and links each to its page", async () => {
    mocks.list.mockResolvedValue([job("a", "done", { authorized: 20, accepted: 20 }, "notas.csv"), job("b", "ready", { valid: 8, total: 10 })]);
    show();
    expect(await screen.findByText("notas.csv")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledWith(10, expect.anything());
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/app/invoices/import?id=a", "/app/invoices/import?id=b"]);
  });

  it("highlights an import with invoices waiting for credits and invites to continue", async () => {
    mocks.list.mockResolvedValue([job("a", "done", { authorized: 20, accepted: 20, awaitingCredits: 277 })]);
    show();
    expect(await screen.findByText(/277 waiting for credits/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /continue/i }).getAttribute("href")).toBe("/app/invoices/import?id=a");
  });

  it("describes the other states in plain words", async () => {
    mocks.list.mockResolvedValue([job("p", "processing"), job("f", "failed"), job("r", "ready", { valid: 5 }), job("e", "emitting", { pending: 3 })]);
    show();
    await screen.findByText("p.csv");
    for (const text of [/reading/i, /could not be read/i, /ready to review/i, /issuing/i]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it("shows nothing when there is no earlier import, or when loading fails", async () => {
    mocks.list.mockResolvedValue([]);
    const { container } = show();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    cleanup();
    mocks.list.mockRejectedValue(new Error("down"));
    const again = show();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(again.container.textContent).toBe("");
  });
});
