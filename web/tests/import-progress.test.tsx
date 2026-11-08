// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportProgress } from "@/components/imports/import-progress";
import type { ImportJob } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ emit: vi.fn(), errorsCsv: vi.fn(), download: vi.fn(), toastError: vi.fn(), balance: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), imports: { emit: mocks.emit, errorsCsv: mocks.errorsCsv }, credits: { balance: mocks.balance } }));
vi.mock("@/lib/download", () => ({ saveBlob: mocks.download }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError, success: vi.fn() }) }));

const job = (status: ImportJob["status"], counters: Partial<ImportJob["counters"]> = {}): ImportJob => ({
  id: "i1", status, fileName: "n.csv", companyId: null, errorCode: null, rowsExpected: null, unknownColumns: [], emitStartedAt: null, emitFinishedAt: null, createdAt: "",
  counters: { total: 10, valid: 0, invalid: 2, accepted: 8, authorized: 4, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 2, pending: 4, authorizedAmount: 0, pendingAmount: 0, failedAmount: 0, ...counters },
});
const show = (j: ImportJob, onRefresh = vi.fn().mockResolvedValue(undefined), onAnother = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ImportProgress job={j} onRefresh={onRefresh} onAnother={onAnother} /></NextIntlClientProvider>);
  return { onRefresh, onAnother };
};
const tile = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";

beforeEach(() => { vi.clearAllMocks(); mocks.balance.mockResolvedValue({ tenantId: "t", balance: 3, hardLimit: null }); });
afterEach(cleanup);

describe("ImportProgress", () => {
  it("shows the counters, what is still running and the bar while emitting", () => {
    show(job("emitting"));
    expect(screen.getByRole("heading", { name: /issuing your invoices/i })).toBeTruthy();
    for (const [label, n] of [["Accepted", "8"], ["With errors", "2"], ["In progress", "4"]] as const) expect(tile(label)).toContain(n);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText(/you can close this page/i)).toBeTruthy();
    expect(screen.queryByText("Waiting for credits")).toBeNull();
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

  it("leads with how many invoices were authorized, out of how many are being issued", () => {
    show(job("emitting"));
    const hero = screen.getByTestId("authorized-hero");
    expect(hero.textContent).toContain("4");
    expect(hero.textContent).toMatch(/authorized of 8/i);
  });

  it("draws the bar in two layers: final answers and invoices still in flight", () => {
    show(job("emitting", { total: 10, invalid: 2, authorized: 4, failed: 2, pending: 2 }));
    expect(screen.getByTestId("bar-final").style.width).toBe("50%");
    expect(screen.getByTestId("bar-flight").style.width).toBe("25%");
  });

  describe("when the credits ran out", () => {
    const paused = (extra: Partial<ImportJob["counters"]> = {}) => job("done", { total: 300, invalid: 3, accepted: 20, authorized: 17, awaitingCredits: 277, failed: 3, pending: 0, ...extra });

    it("is not called an error: its own count, a calm title, and the way to continue", () => {
      show(paused());
      expect(screen.getByRole("heading", { name: /credits ran out/i })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /import finished/i })).toBeNull();
      expect(tile("Waiting for credits")).toContain("277");
      expect(screen.getByTestId("waiting-hero").textContent).toContain("277");
      expect(tile("With errors")).toContain("3");
      expect(screen.getByText(/277 invoices are waiting for credits/i)).toBeTruthy();
      expect(screen.getByRole("link", { name: /buy credits/i }).getAttribute("href")).toBe("/app/billing");
      expect(screen.getByRole("button", { name: /issue the 277 that are left/i })).toBeTruthy();
    });

    it("issues the rest again with one click and reads the import again", async () => {
      mocks.emit.mockResolvedValue(job("emitting"));
      const { onRefresh } = show(paused());
      fireEvent.click(screen.getByRole("button", { name: /issue the 277 that are left/i }));
      await waitFor(() => expect(onRefresh).toHaveBeenCalled());
      expect(mocks.emit).toHaveBeenCalledWith("i1");
    });

    it("says so when it still cannot issue", async () => {
      mocks.emit.mockRejectedValue(new Error("no"));
      show(paused({ awaitingCredits: 1 }));
      fireEvent.click(screen.getByRole("button", { name: /issue the 1 that is left|issue the 1 that are left/i }));
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    });

    it("shows the call to continue even while other invoices are still being processed", () => {
      show(job("emitting", { awaitingCredits: 5, pending: 3 }));
      expect(screen.getByRole("button", { name: /issue the 5 that are left/i })).toBeTruthy();
    });

    it("shows the money that is waiting and the current balance, and reads the balance again when the person comes back", async () => {
      show(paused({ awaitingAmount: 12345.6 }));
      expect(screen.getByText(/12,345\.60 waiting to be issued/i)).toBeTruthy();
      expect(await screen.findByText(/current balance: 3 credits/i)).toBeTruthy();
      mocks.balance.mockResolvedValue({ tenantId: "t", balance: 400, hardLimit: null });
      fireEvent(window, new Event("focus"));
      expect(await screen.findByText(/current balance: 400 credits/i)).toBeTruthy();
    });

    it("does not break when the balance cannot be read", async () => {
      mocks.balance.mockRejectedValue(new Error("down"));
      show(paused());
      await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: /issue the 277 that are left/i })).toBeTruthy();
    });
  });

  describe("amounts and the live pulse", () => {
    it("shows, in reais, what is authorized, still in progress and with errors", () => {
      show(job("emitting", { authorizedAmount: 1500.5, pendingAmount: 820, failedAmount: 99.9 }));
      expect(screen.getByTestId("amount-authorized").textContent).toContain("1,500.50");
      expect(screen.getByTestId("amount-pending").textContent).toContain("820.00");
      expect(screen.getByTestId("amount-failed").textContent).toContain("99.90");
    });

    it("leaves the error amount out while nothing failed", () => {
      show(job("emitting", { authorizedAmount: 10, pendingAmount: 5, failedAmount: 0 }));
      expect(screen.queryByTestId("amount-failed")).toBeNull();
    });

    it("pulses while issuing and goes quiet when done", () => {
      const live = { updatedAt: Date.now(), changedAt: Date.now(), reconnecting: false };
      const { unmount } = render(<NextIntlClientProvider locale="en" messages={messages}><ImportProgress job={job("emitting")} onRefresh={vi.fn()} onAnother={vi.fn()} live={live} /></NextIntlClientProvider>);
      expect(screen.getByText("Live")).toBeTruthy();
      unmount();
      render(<NextIntlClientProvider locale="en" messages={messages}><ImportProgress job={job("done", { pending: 0 })} onRefresh={vi.fn()} onAnother={vi.fn()} live={live} /></NextIntlClientProvider>);
      expect(screen.queryByText("Live")).toBeNull();
    });
  });
});
