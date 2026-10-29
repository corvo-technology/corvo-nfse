import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

/**
 * The banner reads its texts with useTranslations, so it has to render inside the
 * NextIntlClientProvider; outside it, every page that shows the banner answers 500.
 */
describe("cookie consent banner placement", () => {
  it.each(["app/[locale]/layout.tsx", "app/(dashboard)/layout.tsx"])("%s renders the banner inside the translations provider", (layout) => {
    const source = read(layout);
    const provider = source.indexOf("<NextIntlClientProvider");
    const banner = source.indexOf("<CookieConsentWrapper");
    const closing = source.indexOf("</NextIntlClientProvider>");
    expect(provider).toBeGreaterThan(-1);
    expect(banner).toBeGreaterThan(provider);
    expect(banner).toBeLessThan(closing);
  });
});
