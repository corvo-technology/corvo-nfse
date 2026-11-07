// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportProgress } from "@/components/imports/import-progress";
import type { ImportJob, ImportRow } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), emit: vi.fn(), errorsCsv: vi.fn(), download: vi.fn(), toastError: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), imports: { rows: mocks.rows, emit: mocks.emit, errorsCsv: mocks.errorsCsv } }));
vi.mock("@/lib/download", () => ({ saveBlob: mocks.download }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError, success: vi.fn() }) }));

const job = (status: ImportJob["status"], counters: Partial<ImportJob["counters"]> = {}): ImportJob => ({
  id: "i1", status, fileName: "n.csv", companyId: null, errorCode: null, emitStartedAt: null, emitFinishedAt: null, createdAt: "",
  counters: { total: 10, valid: 0, invalid: 2, accepted: 8, authorized: 4, failed: 2, pending: 4, ...counters },
});
const rejected = (line: number, errorCode: string): ImportRow => ({ line, data: {}, status: "rejected", errorCode, errorMessage: null, invoiceId: null });
const show = (j: ImportJob, onRefresh = vi.fn().mockResolvedValue(undefined), onAnother = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ImportProgress job={j} onRefresh={onRefresh} onAnother={onAnother} /></NextIntlClientProvider>);
  return { onRefresh, onAnother };
};

beforeEach(() => { vi.clearAllMocks(); mocks.rows.mockResolvedValue({ items: [], hasMore: false, nextCursor: null }); });
afterEach(cleanup);

describe("ImportProgress", () => {
  it("shows the three counters, what is still running and the bar while emitting", () => {
    show(job("emitting"));
    expect(screen.getByRole("heading", { name: /issuing your invoices/i })).toBeTruthy();
    for (const [label, n] of [["Accepted", "8"], ["Authorized", "4"], ["With errors", "2"], ["In progress", "4"]] as const)
      expect(screen.getByText(label).parentElement?.textContent).toContain(n);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText(/you can close this page/i)).toBeTruthy();
  });

  it("when done, says so and offers the invoices or another import", () => {
    const { onAnother } = show(job("done", { authorized: 8, failed: 2, pending: 0 }));
    expect(screen.getByRole("heading", { name: /import finished/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /see the invoices/i }).getAttribute("href")).toBe("/app/invoices");
    fireEvent.click(screen.getByRole("button", { name: /import another spreadsheet/i }));
    expect(onAnother).toHaveBeenCalled();
  });

  it("downloads the errors only when there are some", async () => {
    const blob = new Blob(["x"]); mocks.errorsCsv.mockResolvedValue(blob);
    show(job("done", { failed: 2, pending: 0 }));
    fireEvent.click(screen.getByRole("button", { name: /download only the errors/i }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(blob, "erros-importacao.csv"));
    cleanup();
    show(job("done", { failed: 0, invalid: 0, pending: 0 }));
    expect(screen.queryByRole("button", { name: /download only the errors/i })).toBeNull();
  });

  it("offers to issue again the rows the plan limit turned away, and only those", async () => {
    mocks.rows.mockResolvedValue({ items: [rejected(3, "ERROR_MONTHLY_LIMIT_EXCEEDED"), rejected(4, "ERROR_VALIDATION"), rejected(5, "ERROR_INSUFFICIENT_CREDITS")], hasMore: false, nextCursor: null });
    mocks.emit.mockResolvedValue(job("emitting"));
    const { onRefresh } = show(job("done", { failed: 3, pending: 0 }));
    expect(await screen.findByText(/2 invoices were left without credits/i)).toBeTruthy();
    expect(mocks.rows).toHaveBeenCalledWith("i1", { status: "rejected", limit: 200 }, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /issue again/i }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(mocks.emit).toHaveBeenCalledWith("i1");
  });

  it("shows no credit notice when nothing was turned away", async () => {
    mocks.rows.mockResolvedValue({ items: [rejected(4, "ERROR_VALIDATION")], hasMore: false, nextCursor: null });
    show(job("done", { failed: 1, pending: 0 }));
    await waitFor(() => expect(mocks.rows).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /issue again/i })).toBeNull();
  });
});
