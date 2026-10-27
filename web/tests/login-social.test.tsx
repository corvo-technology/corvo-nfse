// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(dashboard)/(auth)/login/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), query: "" }));
vi.mock("@/lib/api", async (original) => {
  const real = await original<typeof import("@/lib/api")>();
  return { ...real, auth: { ...real.auth, oauthProviders: mocks.providers } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ verifyCode: vi.fn(), refreshSession: vi.fn(), isAuthenticated: false }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ replace: vi.fn() }),
}));

const assign = vi.fn();
const renderLogin = () => render(<NextIntlClientProvider locale="en" messages={messages}><LoginPage /></NextIntlClientProvider>);
const google = () => screen.getByRole("button", { name: /Google/ }) as HTMLButtonElement;
const github = () => screen.getByRole("button", { name: /GitHub/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = "mode=login";
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});
afterEach(cleanup);

describe("login: social buttons", () => {
  it("stay disabled when the server has no provider configured", async () => {
    mocks.providers.mockResolvedValue({ google: false, github: false });
    renderLogin();
    await waitFor(() => expect(mocks.providers).toHaveBeenCalled());
    expect(google().disabled).toBe(true);
    expect(github().disabled).toBe(true);
  });

  it("enable only the configured provider and start the flow on click", async () => {
    mocks.providers.mockResolvedValue({ google: true, github: false });
    renderLogin();
    await waitFor(() => expect(google().disabled).toBe(false));
    expect(github().disabled).toBe(true);
    fireEvent.click(google());
    expect(assign).toHaveBeenCalledWith("/api/proxy/v1/auth/oauth/google/authorize");
  });

  it("carry the page to resume on, such as the AI agent consent screen", async () => {
    mocks.query = "mode=login&next=%2Fmcp%2Fauthorize%3Fclient_id%3Dx";
    mocks.providers.mockResolvedValue({ google: false, github: true });
    renderLogin();
    await waitFor(() => expect(github().disabled).toBe(false));
    fireEvent.click(github());
    expect(assign).toHaveBeenCalledWith(`/api/proxy/v1/auth/oauth/github/authorize?next=${encodeURIComponent("/mcp/authorize?client_id=x")}`);
  });

  it("keep working with the email code when the providers request fails", async () => {
    mocks.providers.mockRejectedValue(new Error("down"));
    renderLogin();
    await waitFor(() => expect(mocks.providers).toHaveBeenCalled());
    expect(google().disabled).toBe(true);
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy();
  });

  it("show why the sign-in failed when the provider sends the user back", async () => {
    mocks.query = "mode=login&error=oauth_email_unverified";
    mocks.providers.mockResolvedValue({ google: true, github: true });
    renderLogin();
    expect(await screen.findByText(/not verified with the provider/)).toBeTruthy();
  });

  it("ignore an unknown error code in the address", async () => {
    mocks.query = "mode=login&error=<script>";
    mocks.providers.mockResolvedValue({ google: true, github: true });
    renderLogin();
    await waitFor(() => expect(google().disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
