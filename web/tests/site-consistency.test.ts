import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { buildLlmsFull, buildLlmsTxt } from "@/lib/llms";
import { getDocsTree } from "@/lib/docs/registry";

const WEB = join(__dirname, "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

/** Every corvo.tech URL that the site actually serves. */
const knownUrls = () =>
  new Set([
    ...sitemap().map((entry) => entry.url),
    "https://corvo.tech/llms.txt",
    "https://corvo.tech/llms-full.txt",
    "https://corvo.tech/pt/llms.txt",
    "https://corvo.tech/pt/llms-full.txt",
    "https://corvo.tech/sitemap.xml",
    "https://corvo.tech/robots.txt",
  ]);

const siteLinks = (text: string) =>
  [...text.matchAll(/https:\/\/corvo\.tech(\/[^\s)`"'<>]*)?/g)]
    .map((match) => match[0].replace(/[.,;:]+$/, ""))
    .filter((url) => !url.includes("/login") && url !== "https://corvo.tech");

describe("links in the generated llms.txt and llms-full.txt", () => {
  for (const locale of ["en", "pt"] as const) {
    it(`only point to pages that exist in ${locale}`, () => {
      const known = knownUrls();
      const text = buildLlmsTxt(locale) + buildLlmsFull(locale);
      const dead = [...new Set(siteLinks(text))].filter((url) => !known.has(url));
      expect(dead).toEqual([]);
    });
  }
});

describe("issuance status code", () => {
  it("shows 202 (asynchronous) for POST /v1/invoices on the landing, never 201", () => {
    const architecture = read("components/landing/architecture.tsx");
    expect(architecture).not.toMatch(/POST \/v1\/invoices\s*<span[^>]*>201</);
    expect(architecture).toMatch(/POST \/v1\/invoices\s*<span[^>]*>202</);
  });
});

describe("tax regimes", () => {
  it("does not promise regimes other than MEI and Simples Nacional (the API answers 422)", () => {
    for (const locale of ["en", "pt"] as const) {
      expect(JSON.stringify(getDocsTree(locale)!.home.blocks)).not.toMatch(/other regimes|outros regimes/);
    }
    for (const locale of ["en", "pt"] as const) expect(buildLlmsTxt(locale)).not.toMatch(/regimes need|first; other regimes|regimes precisam/);
    expect(buildLlmsTxt("en")).toContain("MEI and Simples Nacional only");
    expect(buildLlmsTxt("pt")).toContain("só MEI e Simples Nacional");
  });
});
