// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CookieConsentWrapper } from "@/components/CookieConsentWrapper";

const state = vi.hoisted(() => ({
  pathname: "/pt",
  consent: null as "accepted" | "rejected" | null,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/lib/consent", () => ({ useCookieConsent: () => state.consent }));
vi.mock("@/components/GoogleAnalytics", () => ({ GoogleAnalytics: () => <div data-testid="analytics" /> }));
vi.mock("@/components/MetaPixel", () => ({ MetaPixel: () => <div data-testid="meta-pixel" /> }));
vi.mock("@/components/ui/cookie-consent", () => ({ CookieConsent: () => <div data-testid="consent-banner" /> }));

afterEach(() => { cleanup(); state.consent = null; });

describe("optional cookie consent", () => {
  it.each([
    "/login", "/app", "/app/invoices", "/pt/terms", "/en/terms",
    "/pt/privacy", "/en/privacy", "/pt/dpa", "/en/dpa",
    "/pt/security", "/en/security",
  ])("keeps %s accessible without a banner or analytics before consent", (pathname) => {
    state.pathname = pathname;
    const { container } = render(<CookieConsentWrapper />);
    expect(container.childElementCount).toBe(0);
  });

  it.each(["/", "/pt", "/en", "/pt/docs"])("offers consent on public page %s without loading analytics", (pathname) => {
    state.pathname = pathname;
    render(<CookieConsentWrapper />);
    expect(screen.queryByTestId("consent-banner")).not.toBeNull();
    expect(screen.queryByTestId("analytics")).toBeNull();
    expect(screen.queryByTestId("meta-pixel")).toBeNull();
  });

  it("loads analytics and the Meta Pixel on a legal page only after prior consent", () => {
    state.pathname = "/pt/privacy";
    state.consent = "accepted";
    render(<CookieConsentWrapper />);
    expect(screen.queryByTestId("analytics")).not.toBeNull();
    expect(screen.queryByTestId("meta-pixel")).not.toBeNull();
    expect(screen.queryByTestId("consent-banner")).toBeNull();
  });

  it("shows neither the banner nor analytics once cookies are rejected", () => {
    state.pathname = "/pt";
    state.consent = "rejected";
    const { container } = render(<CookieConsentWrapper />);
    expect(container.childElementCount).toBe(0);
  });
});
