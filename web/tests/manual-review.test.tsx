// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualReviewActions } from "@/components/invoices/manual-review-actions";
import { PortalStatusBanner } from "@/components/dashboard/portal-status-banner";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ review: vi.fn(), status: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  invoices: { review: mocks.review },
  fiscalPortal: { status: mocks.status },
}));

const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ManualReviewActions", () => {
  it("retries every invoice in the batch with one action and reports what happened", async () => {
    mocks.review.mockResolvedValue([
      { id: "a", outcome: "accepted" },
      { id: "b", outcome: "accepted" },
      { id: "c", outcome: "skipped", reason: "not_in_manual_review" },
    ]);
    const onDone = vi.fn();
    wrap(<ManualReviewActions invoiceIds={["a", "b", "c"]} onDone={onDone} />);

    expect(screen.getByRole("heading", { name: "What to do with the 3 invoices in manual review" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry all 3" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.review).toHaveBeenCalledWith("retry", ["a", "b", "c"]);
    expect(mocks.success).toHaveBeenCalledWith("2 invoices went back to the portal. 1 had already left review.");
  });

  it("discards only after the person confirms what the portal check means", async () => {
    mocks.review.mockResolvedValue([{ id: "a", outcome: "accepted" }]);
    wrap(<ManualReviewActions invoiceIds={["a"]} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(mocks.review).not.toHaveBeenCalled();
    expect(screen.getByText(/Only an invoice that was never registered is discarded/)).toBeTruthy();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Discard")!);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith("discard", ["a"]));
  });

  it("keeps the panel and shows the error when the request fails", async () => {
    mocks.review.mockRejectedValue(new Error("network"));
    const onDone = vi.fn();
    wrap(<ManualReviewActions invoiceIds={["a"]} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says the action is unavailable when the proxy refuses the route, not the generic failure", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.review.mockRejectedValue(new ApiError(404, "Route unavailable", "proxy_route_unavailable"));
    wrap(<ManualReviewActions invoiceIds={["a"]} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(messages.ApiErrors.proxy_route_unavailable));
  });

  it("only offers discard when the invoice number already belongs to another invoice", async () => {
    mocks.review.mockResolvedValue([{ id: "a", outcome: "accepted" }]);
    wrap(<ManualReviewActions invoiceIds={["a"]} dpsUsedByOther onDone={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText(messages.ManualReview.dpsUsed.why)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText(messages.ManualReview.dpsUsed.confirmBody)).toBeTruthy();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Discard")!);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith("discard", ["a"]));
  });

  it("tells which invoices were not retried because their number belongs to another invoice", async () => {
    mocks.review.mockResolvedValue([
      { id: "a", outcome: "accepted" },
      { id: "b", outcome: "skipped", reason: "dps_used_by_other_nfse" },
    ]);
    const onDone = vi.fn();
    wrap(<ManualReviewActions invoiceIds={["a", "b"]} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry all 2" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.success).toHaveBeenCalledWith("1 invoice went back to the portal. 1 was not retried: its number already belongs to another invoice. Discard it.");
  });

  it("shows nothing without invoices", () => {
    const { container } = wrap(<ManualReviewActions invoiceIds={[]} onDone={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});

describe("PortalStatusBanner", () => {
  it("tells the invoices are kept in the queue while the portal is down", async () => {
    mocks.status.mockResolvedValue({ environment: "live", available: false, since: "2026-11-08T15:00:00.000Z", retryAt: null });
    wrap(<PortalStatusBanner environment="t:live" />);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(messages.PortalStatus.body);
  });

  it("says plainly when the trouble is on our side, even while emission is not paused", async () => {
    mocks.status.mockResolvedValue({ environment: "live", available: true, since: null, retryAt: null, connection: { state: "gov_unreachable_from_us", since: "2026-11-08T15:00:00.000Z", ourSide: true } });
    wrap(<PortalStatusBanner environment="t:live" />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain(messages.PortalStatus.ourSideTitle);
    expect(banner.textContent).toContain(messages.PortalStatus.ourSideBody);
    expect(banner.textContent).not.toMatch(/guara/i);
  });

  it("keeps the portal-down copy when the portal itself is down", async () => {
    mocks.status.mockResolvedValue({ environment: "live", available: false, since: null, retryAt: null, connection: { state: "portal_down", since: null, ourSide: false } });
    wrap(<PortalStatusBanner environment="t:live" />);
    expect((await screen.findByRole("status")).textContent).toContain(messages.PortalStatus.title);
  });

  it("stays hidden while the portal answers or the status cannot be read", async () => {
    mocks.status.mockResolvedValueOnce({ environment: "live", available: true, since: null, retryAt: null });
    const first = wrap(<PortalStatusBanner environment="t:live" />);
    await act(async () => { await Promise.resolve(); });
    expect(first.container.textContent).toBe("");
    cleanup();

    mocks.status.mockRejectedValueOnce(new Error("offline"));
    const second = wrap(<PortalStatusBanner environment="t:live" />);
    await act(async () => { await Promise.resolve(); });
    expect(second.container.textContent).toBe("");
  });
});
