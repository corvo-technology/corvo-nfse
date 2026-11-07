// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstNoteBanner } from "@/components/onboarding/first-note-banner";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ list: vi.fn(), env: "test" as "test" | "live" }));
vi.mock("@/lib/api", () => ({ invoices: { list: mocks.list } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ tenantId: "t1", fiscalEnvironment: mocks.env }) }));

const only = (id: string) => ({ items: [{ id }], hasMore: false, nextCursor: null });
const renderBanner = (invoiceId = "n1") => render(<NextIntlClientProvider locale="en" messages={messages}><FirstNoteBanner invoiceId={invoiceId} /></NextIntlClientProvider>);
const highlight = vi.fn();

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.env = "test";
  mocks.list.mockResolvedValue(only("n1"));
  window.addEventListener("onboarding-highlight-env", highlight);
});
afterEach(() => { cleanup(); window.removeEventListener("onboarding-highlight-env", highlight); });

describe("FirstNoteBanner", () => {
  it("explains the first test note and asks to highlight the environment selector once", async () => {
    renderBanner();
    await screen.findByText(messages.Onboarding.note.title);
    expect(screen.getByText(/does not use credits/)).toBeTruthy();
    expect(screen.getByText(/PDF and XML/)).toBeTruthy();
    expect(screen.getByText(/Status: authorized/)).toBeTruthy();
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it("does not show on a note that is not the account's only test note", async () => {
    mocks.list.mockResolvedValue({ items: [{ id: "n2" }, { id: "n1" }], hasMore: false, nextCursor: null });
    renderBanner();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(screen.queryByText(messages.Onboarding.note.title)).toBeNull();
    cleanup();
    mocks.list.mockResolvedValue(only("other"));
    renderBanner();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(messages.Onboarding.note.title)).toBeNull();
  });

  it("stays away once dismissed", async () => {
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Got it" }));
    expect(screen.queryByText(messages.Onboarding.note.title)).toBeNull();
    cleanup();
    renderBanner();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(messages.Onboarding.note.title)).toBeNull();
  });

  it("is off in live and without calling the API", () => {
    mocks.env = "live";
    renderBanner();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.queryByText(messages.Onboarding.note.title)).toBeNull();
  });

  it("when the list fails it shows nothing and no error", async () => {
    mocks.list.mockRejectedValue(new Error("boom"));
    renderBanner();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(screen.queryByText(messages.Onboarding.note.title)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
