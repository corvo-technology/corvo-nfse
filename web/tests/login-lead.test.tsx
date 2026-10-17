// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), magicLinkRequest: vi.fn(), query: "mode=signup" }));
vi.mock("@/lib/api", async (original) => {
  const real = await original<typeof import("@/lib/api")>();
  return { ...real, auth: { ...real.auth, oauthProviders: mocks.providers, magicLinkRequest: mocks.magicLinkRequest } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ verifyCode: vi.fn(), refreshSession: vi.fn(), isAuthenticated: false }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ replace: vi.fn() }),
}));

const trackMetaMock = vi.fn();
vi.mock("@/components/MetaPixel", () => ({ trackMeta: (...args: unknown[]) => trackMetaMock(...args) }));

const renderLogin = () => render(<NextIntlClientProvider locale="en" messages={messages}><LoginPage /></NextIntlClientProvider>);

let challengeCounter = 0;
function nextChallenge() {
  challengeCounter += 1;
  return {
    challengeId: `challenge-${challengeCounter}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() - 1_000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = "mode=signup";
  challengeCounter = 0;
  mocks.providers.mockResolvedValue({ google: false, github: false });
  mocks.magicLinkRequest.mockImplementation(() => Promise.resolve(nextChallenge()));
});
afterEach(cleanup);

describe("login: Lead dedup on resend", () => {
  it("fires one Lead for the first code send and none on resend", async () => {
    renderLogin();
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await waitFor(() => expect(mocks.magicLinkRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trackMetaMock).toHaveBeenCalledTimes(1));
    expect(trackMetaMock).toHaveBeenCalledWith("Lead", {}, expect.any(String));

    const resendButton = await screen.findByRole("button", { name: /resend code/i });
    fireEvent.click(resendButton);
    await waitFor(() => expect(mocks.magicLinkRequest).toHaveBeenCalledTimes(2));

    expect(trackMetaMock).toHaveBeenCalledTimes(1);
  });
});
