// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportReview } from "@/components/imports/import-review";
import { ApiError } from "@/lib/api";
import type { ImportJob, ImportRow } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), updateRow: vi.fn(), emit: vi.fn(), discard: vi.fn(), errorsCsv: vi.fn(), download: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  imports: { rows: mocks.rows, updateRow: mocks.updateRow, emit: mocks.emit, discard: mocks.discard, errorsCsv: mocks.errorsCsv },
}));
vi.mock("@/lib/download", () => ({ saveBlob: mocks.download }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError, success: mocks.toastSuccess }) }));

const job = (over: Partial<ImportJob["counters"]> = {}): ImportJob => ({ id: "i1", status: "ready", fileName: "n.csv", companyId: null, errorCode: null, emitStartedAt: null, emitFinishedAt: null, createdAt: "", counters: { total: 3, valid: 2, invalid: 1, accepted: 0, authorized: 0, awaitingCredits: 0, failed: 1, pending: 2, ...over } });
const row = (line: number, over: Partial<ImportRow> = {}): ImportRow => ({
  line, status: "valid", errorCode: null, errorMessage: null, invoiceId: null,
  data: { amount: 100 * line, competenceDate: "2026-11-07", customer: { name: `Cliente ${line}`, taxId: "52998224725", email: "c@x.com" }, service: { description: `Serviço ${line}`, code: "010101" } }, ...over,
});
const page = (items: ImportRow[], nextCursor: string | null = null) => ({ items, hasMore: nextCursor !== null, nextCursor });
const invalidRow = row(4, { status: "invalid", errorCode: "ERROR_IMPORT_COMPANY_REQUIRED", errorMessage: "no company" });

const show = (props: Partial<React.ComponentProps<typeof ImportReview>> = {}) => {
  const handlers = { onChanged: vi.fn().mockResolvedValue(undefined), onEmitted: vi.fn(), onDiscarded: vi.fn() };
  render(<NextIntlClientProvider locale="en" messages={messages}><ImportReview job={job()} duplicateOf={null} {...handlers} {...props} /></NextIntlClientProvider>);
  return handlers;
};

beforeEach(() => { vi.clearAllMocks(); mocks.rows.mockResolvedValue(page([row(2), row(3), invalidRow])); });
afterEach(cleanup);

describe("ImportReview", () => {
  it("summarizes the import and lists the rows, with the problem of a bad row in plain words", async () => {
    show();
    expect(screen.getByText(/3 rows: 2 ready, 1 with errors/i)).toBeTruthy();
    expect(await screen.findAllByText("Cliente 2")).not.toHaveLength(0);
    expect(screen.getAllByText(/This row has no company/i).length).toBeGreaterThan(0);
    expect(mocks.rows).toHaveBeenCalledWith("i1", { status: undefined, cursor: undefined, limit: 50 }, expect.anything());
  });

  it("filters to the rows with errors", async () => {
    show();
    await screen.findAllByText("Cliente 2");
    fireEvent.click(screen.getByRole("button", { name: /with errors/i }));
    await waitFor(() => expect(mocks.rows).toHaveBeenLastCalledWith("i1", { status: "invalid", cursor: undefined, limit: 50 }, expect.anything()));
  });

  it("loads the next page on demand", async () => {
    mocks.rows.mockResolvedValueOnce(page([row(2)], "2")).mockResolvedValueOnce(page([row(3)]));
    show();
    await screen.findAllByText("Cliente 2");
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findAllByText("Cliente 3");
    expect(mocks.rows).toHaveBeenLastCalledWith("i1", { status: undefined, cursor: "2", limit: 50 }, undefined);
  });

  it("fixes a row: sends the whole customer and service, then refreshes the counters", async () => {
    mocks.updateRow.mockResolvedValue(row(4));
    const { onChanged } = show();
    fireEvent.click((await screen.findAllByRole("button", { name: /^fix$/i }))[0]!);
    fireEvent.change(screen.getByLabelText(/customer e-mail/i), { target: { value: "novo@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /save and check/i }));
    await waitFor(() => expect(mocks.updateRow).toHaveBeenCalledWith("i1", 4, { amount: 400, competenceDate: "2026-11-07", customer: { name: "Cliente 4", taxId: "52998224725", email: "novo@x.com" }, service: { description: "Serviço 4", code: "010101" } }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByLabelText(/customer e-mail/i)).toBeNull();
  });

  it("keeps the editor open and says so when the fix is still wrong", async () => {
    mocks.updateRow.mockResolvedValue(row(4, { status: "invalid", errorCode: "ERROR_VALIDATION", errorMessage: "amount must be a number" }));
    show();
    fireEvent.click((await screen.findAllByRole("button", { name: /^fix$/i }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: /save and check/i }));
    await waitFor(() => expect(screen.getByText(/still a problem with this row/i)).toBeTruthy());
    expect(screen.getByLabelText(/customer e-mail/i)).toBeTruthy();
  });

  it("explains an edit refused because the import already moved on", async () => {
    mocks.updateRow.mockRejectedValue(new ApiError(409, "state", "ERROR_IMPORT_STATE"));
    show();
    fireEvent.click((await screen.findAllByRole("button", { name: /^fix$/i }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: /save and check/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/can no longer be edited/i));
  });

  it("issues the ready rows, and cannot when none is ready", async () => {
    mocks.emit.mockResolvedValue(job());
    const { onEmitted } = show();
    fireEvent.click(screen.getByRole("button", { name: /issue 2 invoices/i }));
    await waitFor(() => expect(onEmitted).toHaveBeenCalled());
    expect(mocks.emit).toHaveBeenCalledWith("i1");
    cleanup();
    show({ job: job({ valid: 0, invalid: 3, total: 3 }) });
    expect((screen.getByRole("button", { name: /no row is ready/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("downloads only the errors, and offers that only when there are errors", async () => {
    const blob = new Blob(["x"]); mocks.errorsCsv.mockResolvedValue(blob);
    show();
    fireEvent.click(screen.getByRole("button", { name: /download only the errors/i }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(blob, "erros-importacao.csv"));
    cleanup();
    show({ job: job({ invalid: 0, valid: 3 }) });
    expect(screen.queryByRole("button", { name: /download only the errors/i })).toBeNull();
  });

  it("discards only after a second confirming click", async () => {
    mocks.discard.mockResolvedValue(null);
    const { onDiscarded } = show();
    fireEvent.click(screen.getByRole("button", { name: /discard import/i }));
    expect(mocks.discard).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("group", { name: /discard/i })).getByRole("button", { name: /discard import/i }));
    await waitFor(() => expect(onDiscarded).toHaveBeenCalled());
  });

  it("warns when the same file was uploaded before", () => {
    show({ duplicateOf: "old" });
    expect(screen.getByText(/already uploaded this exact spreadsheet/i)).toBeTruthy();
  });
});
