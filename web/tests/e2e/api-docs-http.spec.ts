import { expect, test } from "@playwright/test";

// HTTP check against the production server started by playwright.config.ts (`yarn start`).
for (const locale of ["pt", "en"] as const) {
  test(`GET /${locale}/api-docs answers 200 and is indexable`, async ({ request }) => {
    const response = await request.get(`/${locale}/api-docs`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["x-robots-tag"] ?? "").not.toMatch(/noindex/i);
    const html = await response.text();
    expect(html).toContain(`https://www.corvo.tech/${locale}/api-docs`);
  });
}

test("GET /api-docs redirects 301 to /pt/api-docs", async ({ request }) => {
  const response = await request.get("/api-docs", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()["location"]).toMatch(/\/pt\/api-docs$/);
});
