// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebhooksPage from "@/app/(dashboard)/app/webhooks/page";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ deliveries: vi.fn(), list: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true, fiscalEnvironment: "live" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  webhooks: { list: mocks.list, deliveries: mocks.deliveries, retryDelivery: vi.fn(), create: vi.fn(), delete: vi.fn(), test: vi.fn() },
  collectAll: async () => [],
}));

const t = en.Webhooks;
const INVOICE = "123e4567-e89b-12d3-a456-426614174000";
const lastQuery = () => mocks.deliveries.mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => {
  mocks.list.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  mocks.deliveries.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const show = () => render(<NextIntlClientProvider locale="en" messages={en}><WebhooksPage /></NextIntlClientProvider>);

describe("webhooks page filters", () => {
  it("starts with the last 24 hours and no other filter", async () => {
    show();
    await screen.findByText(t.noDeliveries);
    expect(lastQuery()).toMatchObject({ hours: 24, environment: "live" });
    expect(lastQuery().status).toBeUndefined();
    expect(lastQuery().invoice_id).toBeUndefined();
  });

  it("asks for the period, status and event chosen", async () => {
    show();
    await screen.findByText(t.noDeliveries);
    fireEvent.change(screen.getByLabelText(t.filters.period), { target: { value: "720" } });
    fireEvent.change(screen.getByLabelText(t.filters.status), { target: { value: "failed" } });
    fireEvent.change(screen.getByLabelText(t.filters.event), { target: { value: "nfse.invoice.authorized" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ hours: 720, status: "failed", event_type: "nfse.invoice.authorized" }));
    expect(await screen.findByText(t.noDeliveriesFiltered)).toBeTruthy();
  });

  it("filters by invoice only once the id is complete", async () => {
    show();
    await screen.findByText(t.noDeliveries);
    const input = screen.getByLabelText(t.filters.invoice);
    fireEvent.change(input, { target: { value: "123e45" } });
    expect(screen.getByRole("alert").textContent).toBe(t.filters.invoiceInvalid);
    expect(lastQuery().invoice_id).toBeUndefined();
    fireEvent.change(input, { target: { value: INVOICE } });
    await waitFor(() => expect(lastQuery().invoice_id).toBe(INVOICE));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears every filter", async () => {
    show();
    await screen.findByText(t.noDeliveries);
    fireEvent.change(screen.getByLabelText(t.filters.status), { target: { value: "failed" } });
    fireEvent.click(await screen.findByRole("button", { name: t.filters.clear }));
    await waitFor(() => expect(lastQuery().status).toBeUndefined());
    expect((screen.getByLabelText(t.filters.status) as HTMLSelectElement).value).toBe("");
  });
});
