// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationsSection } from "@/components/landing/integrations-section";
import { Nav } from "@/components/landing/nav";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => null }));

const wrap = (locale: "en" | "pt", node: React.ReactNode) =>
  render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : pt}>{node}</NextIntlClientProvider>);

afterEach(cleanup);

describe("landing integrations", () => {
  it("adds Integrations to the header, pointing at the section of the same locale", () => {
    wrap("en", <Nav />);
    const link = screen.getAllByRole("link", { name: "Integrations" })[0];
    expect(link.getAttribute("href")).toBe("/en#integrations");
  });

  it.each([["pt", "Integrações", "/pt#integrations"], ["en", "Integrations", "/en#integrations"]] as const)("the header item exists in %s", (locale, label, href) => {
    wrap(locale, <Nav />);
    expect(screen.getAllByRole("link", { name: label })[0].getAttribute("href")).toBe(href);
  });

  it("shows both platform logos with their names, and what each one covers", () => {
    wrap("pt", <IntegrationsSection />);
    expect(screen.getByRole("img", { name: "Woovi" }).getAttribute("src")).toContain("woovi");
    expect(screen.getByRole("img", { name: "AbacatePay" }).getAttribute("src")).toContain("abacatepay");
    expect(screen.getByText("Cobranças Pix")).toBeTruthy();
    expect(screen.getByText("Pix, cartão e boleto")).toBeTruthy();
  });

  it("is the section the header link scrolls to, and explains the three steps", () => {
    const { container } = wrap("pt", <IntegrationsSection />);
    expect(container.querySelector("section#integrations")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /A nota sai sozinha/ })).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Cole o endereço na plataforma")).toBeTruthy();
  });

  it("says a refund can cancel the invoice on its own, and that it is a setting the client turns on", () => {
    wrap("pt", <IntegrationsSection />);
    expect(screen.getByText("Teve reembolso?")).toBeTruthy();
    expect(screen.getByText(/cancela a nota sozinha.*liga quando quiser/)).toBeTruthy();
    cleanup();
    wrap("en", <IntegrationsSection />);
    expect(screen.getByText("Got a refund?")).toBeTruthy();
    expect(screen.getByText(/cancels the invoice on its own.*turn on/)).toBeTruthy();
  });

  it("sends people to sign up and to the integrations guide in their language", () => {
    wrap("en", <IntegrationsSection />);
    expect(screen.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/login?mode=signup");
    expect(screen.getByRole("link", { name: /Read the integrations guide/ }).getAttribute("href")).toBe("/en/docs/payment-integrations");
  });
});
