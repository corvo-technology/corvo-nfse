// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportPage from "@/app/(dashboard)/app/invoices/import/page";
import type { ImportJob } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), id: null as string | null, job: null as ImportJob | null, error: null as unknown, refresh: vi.fn(), canIssue: true, started: undefined as undefined | ((s: unknown) => void), review: undefined as undefined | Record<string, () => void> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams(mocks.id ? `id=${mocks.id}` : "") }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (p: string) => p === "nfse.invoices.issue" && mocks.canIssue }) }));
vi.mock("@/lib/use-import", () => ({ useImport: () => ({ job: mocks.job, error: mocks.error, refresh: mocks.refresh }) }));
vi.mock("@/components/imports/import-upload", () => ({ ImportUpload: ({ onStarted }: { onStarted: (s: unknown) => void }) => { mocks.started = onStarted; return <p>upload step</p>; } }));
vi.mock("@/lib/use-recent-imports", () => ({ useRecentImports: () => ({ status: "ready", items: [], reload: () => undefined }) }));
vi.mock("@/components/imports/recent-imports", () => ({ RecentImports: () => <p>recent imports</p>, PendingCreditsBanner: () => <p>pending banner</p> }));
vi.mock("@/components/imports/import-reading", () => ({ ImportReading: () => <h2>Reading the spreadsheet</h2> }));
vi.mock("@/components/imports/import-review", () => ({ ImportReview: (props: Record<string, () => void> & { duplicateOf: string | null }) => { mocks.review = props; return <p>review step {String(props.duplicateOf)}</p>; } }));
vi.mock("@/components/imports/import-progress", () => ({ ImportProgress: ({ onAnother }: { onAnother: () => void }) => <button onClick={onAnother}>progress step</button> }));

const job = (status: ImportJob["status"], errorCode: string | null = null): ImportJob => ({ id: "i1", status, fileName: "n.csv", companyId: null, errorCode, rowsExpected: null, unknownColumns: [], emitStartedAt: null, emitFinishedAt: null, createdAt: "", counters: { total: 1, valid: 1, invalid: 0, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 0, pending: 1, authorizedAmount: 0, pendingAmount: 0, failedAmount: 0 } });
const show = () => render(<NextIntlClientProvider locale="en" messages={messages}><ImportPage /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.id = null; mocks.job = null; mocks.error = null; mocks.canIssue = true; });
afterEach(cleanup);

describe("import page", () => {
  it("starts with the upload and moves to the import by putting its id in the address", () => {
    show();
    expect(screen.getByText("upload step")).toBeTruthy();
    expect(screen.getByText("recent imports")).toBeTruthy();
    expect(screen.getByText("pending banner")).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to invoices/i }).getAttribute("href")).toBe("/app/invoices");
    mocks.started?.({ id: "i1", status: "processing", duplicateOf: "old" });
    expect(mocks.replace).toHaveBeenCalledWith("/app/invoices/import?id=i1");
  });

  it("shows the screen that matches the import status", () => {
    mocks.id = "i1";
    mocks.job = job("processing"); show();
    expect(screen.getByRole("heading", { name: /reading the spreadsheet/i })).toBeTruthy();
    cleanup(); mocks.job = job("ready"); show();
    expect(screen.getByText(/review step/)).toBeTruthy();
    cleanup(); mocks.job = job("emitting"); show();
    expect(screen.getByText("progress step")).toBeTruthy();
  });

  it("explains a spreadsheet that could not be read and offers another", () => {
    mocks.id = "i1"; mocks.job = job("failed", "ERROR_IMPORT_TOO_MANY_ROWS"); show();
    expect(screen.getByText(/more than 2,000 rows/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /upload another spreadsheet/i }));
    expect(mocks.replace).toHaveBeenCalledWith("/app/invoices/import");
  });

  it("goes back to the upload after discarding, and to progress after issuing", async () => {
    mocks.id = "i1"; mocks.job = job("ready"); show();
    mocks.review?.onDiscarded?.();
    expect(mocks.replace).toHaveBeenCalledWith("/app/invoices/import");
    mocks.review?.onEmitted?.();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("says when the import cannot be found", () => {
    mocks.id = "gone"; mocks.error = new Error("not found"); show();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /upload another spreadsheet/i }));
    expect(mocks.replace).toHaveBeenCalledWith("/app/invoices/import");
  });

  it("keeps the progress on screen when a read fails while an import is running", () => {
    mocks.id = "i1"; mocks.job = job("emitting"); mocks.error = new Error("502"); show();
    expect(screen.getByText("progress step")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is closed to people who cannot issue invoices", () => {
    mocks.canIssue = false; show();
    expect(screen.queryByText("upload step")).toBeNull();
  });
});
