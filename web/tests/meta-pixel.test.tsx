// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/pt" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("MetaPixel", () => {
  it("renders nothing without NEXT_PUBLIC_META_PIXEL_ID configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    const { MetaPixel } = await import("@/components/MetaPixel");
    const { container } = render(<MetaPixel />);
    expect(container.innerHTML).toBe("");
  });

  it("mounts the Pixel init script (autoConfig off, this Pixel ID) when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "123456789");
    const { MetaPixel } = await import("@/components/MetaPixel");
    render(<MetaPixel />);
    await waitFor(() => {
      const script = document.getElementById("meta-pixel");
      expect(script).not.toBeNull();
      expect(script?.textContent).toContain("autoConfig");
      expect(script?.textContent).toContain("123456789");
    });
  });

  it("trackMeta is a no-op without a configured Pixel ID, even once fbq exists", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    const { trackMeta } = await import("@/components/MetaPixel");
    const fbq = vi.fn();
    (window as unknown as { fbq?: typeof fbq }).fbq = fbq;
    trackMeta("Lead", {}, "lead_123");
    expect(fbq).not.toHaveBeenCalled();
  });

  it("trackMeta forwards the eventID when a Pixel ID is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "123456789");
    const { trackMeta } = await import("@/components/MetaPixel");
    const fbq = vi.fn();
    (window as unknown as { fbq?: typeof fbq }).fbq = fbq;
    trackMeta("CompleteRegistration", {}, "evt-1");
    expect(fbq).toHaveBeenCalledWith("track", "CompleteRegistration", {}, { eventID: "evt-1" });
  });
});
