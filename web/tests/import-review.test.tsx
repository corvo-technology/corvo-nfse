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

const job = (over: Partial<ImportJob["counters"]> = {}): ImportJob => ({ id: "i1", status: "ready", fileName: "n.csv", companyId: null, errorCode: null, rowsExpected: null, unknownColumns: [], emitStartedAt: null, emitFinishedAt: null, createdAt: "", counters: { total: 3, valid: 2, invalid: 1, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 1, pending: 2, ...over } });
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
    expect(screen.getByTestId("stat-ready").textContent).toMatch(/Ready.*2/);
    expect(screen.getByTestId("stat-errors").textContent).toMatch(/With errors.*1/);
    expect(screen.getByText(/3 rows/i)).toBeTruthy();
    expect(await screen.findAllByText("Cliente 2")).not.toHaveLength(0);
    expect(screen.getAllByText(/This row has no company/i).length).toBeGreaterThan(0);
  });

  it("leads with the total to issue, in reais, big", () => {
    show({ job: job({ validAmount: 722706.59, valid: 296, total: 300, invalid: 4 }) });
    const total = screen.getByText("Total to issue").parentElement;
    expect(total?.textContent).toMatch(/722,706\.59/);
  });

  it("opens on the rows with errors when there are some, and on all of them when there are none", async () => {
    show();
    await waitFor(() => expect(mocks.rows).toHaveBeenCalledWith("i1", { status: "invalid", cursor: undefined, limit: 50 }, expect.anything()));
    expect(screen.getByRole("button", { name: /with errors/i }).getAttribute("aria-pressed")).toBe("true");
    cleanup(); vi.clearAllMocks();
    mocks.rows.mockResolvedValue(page([row(2)]));
    show({ job: job({ invalid: 0, valid: 3 }) });
    await waitFor(() => expect(mocks.rows).toHaveBeenCalledWith("i1", { status: undefined, cursor: undefined, limit: 50 }, expect.anything()));
  });

  it("switches to all the rows and back", async () => {
    show();
    await screen.findAllByText("Cliente 2");
    fireEvent.click(screen.getByRole("button", { name: /^all/i }));
    await waitFor(() => expect(mocks.rows).toHaveBeenLastCalledWith("i1", { status: undefined, cursor: undefined, limit: 50 }, expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: /with errors/i }));
    await waitFor(() => expect(mocks.rows).toHaveBeenLastCalledWith("i1", { status: "invalid", cursor: undefined, limit: 50 }, expect.anything()));
  });

  it("loads the next page on demand", async () => {
    mocks.rows.mockResolvedValueOnce(page([row(2)], "2")).mockResolvedValueOnce(page([row(3)]));
    show({ job: job({ invalid: 0, valid: 3 }) });
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

  it("puts the amount on the issue button, so the person knows what is being confirmed", () => {
    show({ job: job({ valid: 2, validAmount: 1500.5 }) });
    expect(screen.getByRole("button", { name: /issue 2 invoices · .*1,500\.50/i })).toBeTruthy();
  });

  it("opens the fix form under its own row and marks the rows with a problem", async () => {
    show();
    fireEvent.click((await screen.findAllByRole("button", { name: /^fix$/i }))[0]!);
    const editor = screen.getByLabelText(/customer e-mail/i).closest("tr");
    expect(editor?.previousElementSibling?.textContent).toMatch(/Cliente 4/);
    expect(document.querySelectorAll(".row-invalid").length).toBeGreaterThan(0);
  });

  it("flashes the row that was just fixed", async () => {
    mocks.updateRow.mockResolvedValue(row(4));
    show();
    fireEvent.click((await screen.findAllByRole("button", { name: /^fix$/i }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: /save and check/i }));
    await waitFor(() => expect(document.querySelectorAll(".row-flash").length).toBeGreaterThan(0));
  });

  it("filters are tabs with their counts, not buttons that compete with the action", async () => {
    show();
    await screen.findAllByText("Cliente 2");
    const all = screen.getByRole("button", { name: /^all/i });
    const errors = screen.getByRole("button", { name: /with errors/i });
    expect(all.textContent).toMatch(/3/);
    expect(errors.textContent).toMatch(/1/);
    expect(screen.getByTestId("action-bar").contains(all)).toBe(false);
    expect(errors.className).not.toMatch(/btn-primary|btn-accent/);
  });

  it("keeps the main action and the discard in one bar that stays on screen, apart from the list tools", async () => {
    show();
    await screen.findAllByText("Cliente 2");
    const bar = screen.getByTestId("action-bar");
    expect(bar.className).toMatch(/sticky/);
    expect(bar.contains(screen.getByRole("button", { name: /issue 2 invoices/i }))).toBe(true);
    expect(bar.contains(screen.getByRole("button", { name: /discard import/i }))).toBe(true);
    expect(bar.contains(screen.getByRole("button", { name: /download only the errors/i }))).toBe(false);
    expect(screen.getByTestId("list-tools").contains(screen.getByRole("button", { name: /download only the errors/i }))).toBe(true);
  });

  it("says there are no errors, in a good way, when the list of errors is empty", async () => {
    mocks.rows.mockResolvedValue(page([]));
    show();
    expect(await screen.findByText(/no errors here/i)).toBeTruthy();
  });

  it("says the list is empty when the whole list is empty", async () => {
    mocks.rows.mockResolvedValue(page([]));
    show({ job: job({ invalid: 0, valid: 0, total: 0 }) });
    expect(await screen.findByText(/no rows in this list/i)).toBeTruthy();
  });

  it("says which spreadsheet columns were ignored, and says nothing when none was", () => {
    show({ job: { ...job(), unknownColumns: ["obs", "cor"] } });
    const note = screen.getByTestId("ignored-columns");
    expect(note.textContent).toMatch(/obs, cor/);
    expect(note.textContent).toMatch(/ignored/i);
    cleanup();
    show();
    expect(screen.queryByTestId("ignored-columns")).toBeNull();
  });
});
