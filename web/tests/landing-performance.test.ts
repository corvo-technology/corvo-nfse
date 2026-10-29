import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { HERO_IMAGE_SIZES } from "@/components/landing/dashboard-showcase";

describe("landing image performance", () => {
  it("serves AVIF and WebP", () => {
    expect((nextConfig as { images?: { formats?: string[] } }).images?.formats).toEqual(["image/avif", "image/webp"]);
  });

  it("keeps the source PNG of the dashboard screenshot under 100 KB", () => {
    expect(statSync(join(__dirname, "..", "public", "dash", "dashboard-hero-2000x1180.png")).size).toBeLessThan(100_000);
  });

  it("caps the hero image at its rendered width instead of the 100vw default", () => {
    expect(HERO_IMAGE_SIZES).toMatch(/1120px$/);
    expect(HERO_IMAGE_SIZES).toContain("max-width: 640px");
  });
});

describe("hero LCP", () => {
  it("does not hide the hero text with opacity 0 before hydration", async () => {
    const { fadeUp } = await import("@/components/landing/hero");
    expect((fadeUp.hidden as { opacity?: number }).opacity).toBeUndefined();
  });
});
