// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FaqSection } from "@/components/landing/faq-section";
import { faqMarkdown, faqPageJsonLd } from "@/lib/landing-faq";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const wrap = (locale: "en" | "pt") => render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : pt}><FaqSection /></NextIntlClientProvider>);

afterEach(cleanup);

describe("landing FAQ", () => {
  it.each(["pt", "en"] as const)("has the five questions in %s, each with its answer in the page", (locale) => {
    const { container } = wrap(locale);
    const items = container.querySelectorAll("details");
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.querySelector("summary")?.textContent?.trim().length).toBeGreaterThan(10);
      expect(item.querySelector("p")?.textContent?.trim().length).toBeGreaterThan(60);
    }
  });

  it("opens on the first question (municipalities) and keeps the others closed", () => {
    const { container } = wrap("pt");
    const open = [...container.querySelectorAll("details")].map((item) => item.open);
    expect(open).toEqual([true, false, false, false, false]);
  });

  it("each answer links to where it goes deeper, in the visitor's language", () => {
    wrap("pt");
    const link = (label: string) => screen.getByRole("link", { name: new RegExp(label) }).getAttribute("href");
    expect(link("Ver a lista de municípios")).toBe("/pt/docs/municipalities");
    expect(link("Ver o guia de início")).toBe("/pt/docs");
    expect(link("Ver os planos")).toBe("/pt#pricing");
    expect(link("Ver como conectar")).toBe("/pt/docs/payment-integrations");
    expect(link("Ver os SDKs")).toBe("/pt/docs/sdks");
  });

  it("covers municipalities, issuing (with email, certificate and regimes), several CNPJs, payment platforms and SDKs", () => {
    wrap("pt");
    for (const question of ["A Corvo atende o município da minha empresa?", "A Corvo emite a nota por mim?", "Posso emitir notas para mais de um CNPJ na Corvo?", "Com quais plataformas de pagamento a Corvo se integra?", "A Corvo tem SDK para a minha linguagem?"])
      expect(screen.getByText(question)).toBeTruthy();
    const issues = screen.getByText("A Corvo emite a nota por mim?").closest("details")!.textContent!;
    for (const part of ["certificado A1", "e-mail", "MEI e Simples Nacional"]) expect(issues).toContain(part);
    expect(screen.getByText(/empresas ilimitadas/)).toBeTruthy();
    expect(screen.getByText(/Woovi e AbacatePay/)).toBeTruthy();
  });

  it.each(["pt", "en"] as const)("the structured data says exactly what the visible FAQ says in %s", (locale) => {
    const { container } = wrap(locale);
    const visible = [...container.querySelectorAll("details")].map((item) => ({ question: item.querySelector("summary")!.textContent!.trim(), answer: item.querySelector("p")!.textContent!.trim() }));
    const entities = (faqPageJsonLd(locale).mainEntity as { name: string; acceptedAnswer: { text: string } }[]).map((entity) => ({ question: entity.name, answer: entity.acceptedAnswer.text }));
    expect(entities).toEqual(visible);
  });

  it.each(["pt", "en"] as const)("llms.txt and llms-full.txt carry the same questions in %s, with their links", async (locale) => {
    const { buildLlmsFull, buildLlmsTxt } = await import("@/lib/llms");
    const markdown = faqMarkdown(locale);
    for (const entity of faqPageJsonLd(locale).mainEntity as { name: string }[]) {
      expect(markdown).toContain(`### ${entity.name}`);
      expect(buildLlmsTxt(locale)).toContain(entity.name);
      expect(buildLlmsFull(locale)).toContain(entity.name);
    }
    expect(buildLlmsTxt(locale)).toContain(`https://www.corvo.tech/${locale}/docs/municipalities`);
  });

  it("is the last section of the landing, right before the footer", () => {
    const source = readFileSync(join(__dirname, "..", "components/landing/landing-page.tsx"), "utf8");
    expect(source.indexOf("<FaqSection")).toBeGreaterThan(source.indexOf("<UseCases"));
    expect(source.indexOf("<FaqSection")).toBeLessThan(source.indexOf("<Footer"));
    expect(source.slice(source.indexOf("<FaqSection"), source.indexOf("<Footer"))).not.toMatch(/<(Pricing|Hero|UseCases|SdksSection)/);
  });
});
