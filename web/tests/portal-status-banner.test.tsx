// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSince, PortalStatusBanner } from "@/components/dashboard/portal-status-banner";
import messages from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fiscalPortal: { status: mocks.status },
}));

afterEach(cleanup);
const renderBanner = () => render(<NextIntlClientProvider locale="pt" messages={messages}><PortalStatusBanner environment="test" /></NextIntlClientProvider>);

describe("PortalStatusBanner", () => {
  it("stays silent while the portal is available", async () => {
    mocks.status.mockResolvedValue({ environment: "test", available: true, since: null, retryAt: null });
    const { container } = renderBanner();
    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("says since when the portal stopped answering", async () => {
    mocks.status.mockResolvedValue({ environment: "test", available: false, since: new Date().toISOString(), retryAt: null });
    renderBanner();
    expect(await screen.findByText(/não responde desde/)).toBeTruthy();
  });

  it("adds the date when the outage did not start today", () => {
    const now = new Date(2026, 10, 27, 10, 0);
    expect(formatSince(new Date(2026, 10, 26, 14, 47), "pt-BR", now)).toBe("26/11 14:47");
    expect(formatSince(new Date(2026, 10, 27, 8, 5), "pt-BR", now)).toBe("08:05");
  });
});
