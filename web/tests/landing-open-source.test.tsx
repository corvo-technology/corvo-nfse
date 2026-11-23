// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { OpenSourceSection } from "@/components/landing/open-source-section";
import { PLANS } from "@/lib/plans-catalog";
import { REPO_URL, SELF_HOSTING_URL } from "@/lib/repo";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => null }));

const wrap = (locale: "en" | "pt", ui: React.ReactNode) =>
  render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : pt}>{ui}</NextIntlClientProvider>);

afterEach(cleanup);

describe("open source on the landing", () => {
  it.each([
    ["en", "Star on GitHub", "Self-hosting guide"],
    ["pt", "Dar uma estrela no GitHub", "Ver guia de self-hosting"],
  ] as const)("the section asks for a star and links the self-hosting guide in %s", (locale, star, guide) => {
    wrap(locale, <OpenSourceSection />);
    const starLink = screen.getByRole("link", { name: new RegExp(star) });
    expect(starLink.getAttribute("href")).toBe(REPO_URL);
    expect(starLink.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: new RegExp(guide) }).getAttribute("href")).toBe(SELF_HOSTING_URL);
    expect(screen.getByText("node scripts/setup-env.mjs")).toBeTruthy();
    expect(screen.getByText(/up -d --build --wait --wait-timeout 180/)).toBeTruthy();
  });

  it.each([
    ["en", "Corvo Cloud", "Start on Cloud", "From R\\$ 59\\.90/month", "Free: you only pay for your server"],
    ["pt", "Corvo Cloud", "Começar na Cloud", "A partir de R\\$ 59,90/mês", "Grátis: você paga só o seu servidor"],
  ] as const)("shows Cloud and self-hosted side by side, with the Solo price from the catalog, in %s", (locale, cloud, cta, price, free) => {
    wrap(locale, <OpenSourceSection />);
    expect(screen.getByRole("heading", { name: cloud })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Self-hosted" })).toBeTruthy();
    expect(screen.getByRole("link", { name: cta }).getAttribute("href")).toBe("/login?mode=signup");
    expect(screen.getByText(new RegExp(price))).toBeTruthy();
    expect(screen.getByText(new RegExp(free))).toBeTruthy();
    expect(PLANS.find((plan) => plan.slug === "solo")?.monthlyCents).toBe(5990);
  });

  it("the nav and the footer link to the repository, opening a new tab", () => {
    wrap("en", <Nav />);
    for (const link of screen.getAllByRole("link", { name: "GitHub" })) {
      expect(link.getAttribute("href")).toBe(REPO_URL);
      expect(link.getAttribute("target")).toBe("_blank");
    }
    cleanup();
    wrap("pt", <Footer />);
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(REPO_URL);
    expect(screen.getByText(/AGPL-3\.0/)).toBeTruthy();
  });
});
