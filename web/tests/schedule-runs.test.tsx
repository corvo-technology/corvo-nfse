// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleRuns } from "@/components/schedules/schedule-runs";
import { ApiError } from "@/lib/api";
import type { ScheduleRun } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ runs: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), schedules: { runs: mocks.runs } }));

const run = (over: Partial<ScheduleRun> = {}): ScheduleRun => ({ id: "r1", occurrenceOn: "2026-11-07", ranOn: "2026-11-09", attempt: 1, outcome: "issued", invoiceId: "inv-1", errorCode: null, errorMessage: null, createdAt: "2026-11-09T12:00:00.000Z", ...over });
const renderRuns = () => render(<NextIntlClientProvider locale="en" messages={messages}><ScheduleRuns scheduleId="s1" /></NextIntlClientProvider>);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ScheduleRuns", () => {
  it("an issued run links to the note; a failed one says why", async () => {
    mocks.runs.mockResolvedValue({ items: [run(), run({ id: "r2", outcome: "failed", invoiceId: null, attempt: 2, errorCode: "ERROR_QUOTA_EXCEEDED", errorMessage: "Plan quota exceeded" })], hasMore: false, nextCursor: null });
    renderRuns();
    const rows = await screen.findAllByTestId("schedule-run");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Issued");
    expect(rows[0].textContent).toContain("Due 11/07/2026");
    expect(rows[0].textContent).toContain("Ran 11/09/2026");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/app/invoices/inv-1");
    expect(rows[1].textContent).toContain("Failed");
    expect(rows[1].textContent).toContain("Attempt 2");
    expect(rows[1].textContent).toContain("Plan quota exceeded");
    expect(rows[1].querySelector("a")).toBeNull();
  });

  it("says when nothing has run yet, and when the log cannot be loaded", async () => {
    mocks.runs.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    renderRuns();
    await screen.findByText(/No runs yet/);
    cleanup();
    mocks.runs.mockRejectedValue(new ApiError(500, "boom"));
    renderRuns();
    await screen.findByText("Could not load the run history.");
  });

  it("loads more when there is another page", async () => {
    mocks.runs.mockResolvedValueOnce({ items: [run()], hasMore: true, nextCursor: "1" }).mockResolvedValueOnce({ items: [run({ id: "r9", ranOn: "2026-11-02" })], hasMore: false, nextCursor: null });
    renderRuns();
    await screen.findAllByTestId("schedule-run");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByTestId("schedule-run")).toHaveLength(2));
    expect(mocks.runs).toHaveBeenLastCalledWith("s1", { cursor: "1" }, expect.anything());
  });
});
