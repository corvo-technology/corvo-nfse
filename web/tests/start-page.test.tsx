import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: "FreeTrial" }) => {
    const messages = (locale === "pt" ? pt : en)[namespace] as Record<string, string>;
    return (key: string) => messages[key];
  },
}));

import StartPage, { generateMetadata } from "@/app/[locale]/start/page";
import { proxy } from "@/proxy";

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe("start page", () => {
  it("renders the steps, the curl snippet, the unchanged free-plan copy and the signup CTA", async () => {
    const html = renderToStaticMarkup(await StartPage(params("pt")));
    expect(html).toContain("Comece grátis");
    expect(html).toContain("corvo_test_");
    expect(html).toContain("/v1/invoices");
    expect(html).toContain(pt.FreeTrial.title);
    expect(html).toContain(pt.FreeTrial.finePrint);
    expect(html).toContain('href="/login?mode=signup"');
    expect(html).not.toContain("FAQPage");
  });

  it("is indexable with canonical and hreflang", async () => {
    const meta = await generateMetadata(params("en"));
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("https://www.corvo.tech/en/start");
    expect(meta.alternates?.languages).toMatchObject({ pt: "https://www.corvo.tech/pt/start" });
  });

  it("redirects /signup permanently to the start page", () => {
    const root = proxy(new NextRequest("https://www.corvo.tech/signup", { headers: { cookie: "NEXT_LOCALE=pt" } }));
    expect(root.status).toBe(308);
    expect(new URL(root.headers.get("location")!).pathname).toBe("/pt/start");
    const en = proxy(new NextRequest("https://www.corvo.tech/en/signup"));
    expect(new URL(en.headers.get("location")!).pathname).toBe("/en/start");
  });
});
