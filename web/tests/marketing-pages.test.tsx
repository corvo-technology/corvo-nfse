// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

type Messages = Record<string, unknown>;
const lookup = (messages: Messages, path: string): string => {
  const value = path.split(".").reduce<unknown>((node, key) => (node as Messages | undefined)?.[key], messages);
  if (typeof value !== "string") throw new Error(`missing message ${path}`);
  return value;
};

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const messages = ((locale === "pt" ? pt : en) as Messages)[namespace] as Messages;
    return (key: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), lookup(messages, key));
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/landing/nav", () => ({ Nav: () => <nav data-testid="nav" /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer data-testid="footer" /> }));

import IntegrationsPage, { generateMetadata as integrationsMeta } from "@/app/[locale]/integrations/page";
import NfePage, { generateMetadata as nfeMeta } from "@/app/[locale]/nf-e/page";
import NfcePage, { generateMetadata as nfceMeta } from "@/app/[locale]/nfc-e/page";
import sitemap from "@/app/sitemap";
import { proxy } from "@/proxy";
import { IntegrationsCatalog, type CatalogGroup } from "@/components/marketing/integrations-catalog";

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });
afterEach(cleanup);

const NAMES = ["Mercado Pago", "Stripe", "Asaas", "Pagar.me", "Woovi", "AbacatePay", "PushinPay", "Hotmart", "Kiwify", "Eduzz", "Monetizze"];

describe("integrations page", () => {
  it("lists the 11 platforms, each with a connect link to sign up", async () => {
    const html = renderToStaticMarkup(await IntegrationsPage(params("pt")));
    for (const name of NAMES) expect(html).toContain(`Conectar ${name}`);
    expect(html).toContain("Integrações · 11 plataformas");
    expect(html).toContain('href="/login?mode=signup"');
    expect(html).toContain("Desligue a nota do próprio Asaas");
    expect(html).toContain("pela sua parte");
    expect(html).toContain('href="/pt/api-docs"');
    expect(html).toContain("mailto:contato@corvo.tech");
  });

  it("has a single h1, in English too", async () => {
    const html = renderToStaticMarkup(await IntegrationsPage(params("en")));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Connect Asaas");
  });

  it("is indexable with canonical and hreflang", async () => {
    const meta = await integrationsMeta(params("en"));
    expect(meta.alternates?.canonical).toBe("https://www.corvo.tech/en/integrations");
    expect(meta.alternates?.languages).toMatchObject({ pt: "https://www.corvo.tech/pt/integrations" });
    expect(meta.openGraph?.url).toBe("https://www.corvo.tech/en/integrations");
  });
});

describe("integrations filter", () => {
  const groups: CatalogGroup[] = [
    { id: "pay", title: "Pagamentos", hint: "h1", cards: [{ id: "a", name: "Asaas", initial: "A", pays: "p", emit: "e1", cancel: "c1", extra: "x1", note: "n1", connect: "Conectar Asaas" }] },
    { id: "info", title: "Infoprodutos", hint: "h2", cards: [{ id: "h", name: "Hotmart", initial: "H", pays: "p", emit: "e2", cancel: "c2", extra: "x2", note: "n2", connect: "Conectar Hotmart" }] },
  ];
  const filters = [{ id: "all", label: "Todas" }, { id: "pay", label: "Pagamentos" }, { id: "info", label: "Infoprodutos" }];

  it("shows every group at first and narrows to the one picked, with aria-pressed on the chips", () => {
    render(<IntegrationsCatalog filters={filters} groups={groups} groupLabel="Filtrar" connectHref="/login?mode=signup" />);
    const chips = within(screen.getByRole("group", { name: "Filtrar" }));
    expect(chips.getByRole("button", { name: "Todas" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Asaas")).toBeTruthy();
    expect(screen.getByText("Hotmart")).toBeTruthy();

    fireEvent.click(chips.getByRole("button", { name: "Infoprodutos" }));
    expect(chips.getByRole("button", { name: "Infoprodutos" }).getAttribute("aria-pressed")).toBe("true");
    expect(chips.getByRole("button", { name: "Todas" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Asaas")).toBeNull();
    expect(screen.getByText("Hotmart")).toBeTruthy();

    fireEvent.click(chips.getByRole("button", { name: "Todas" }));
    expect(screen.getByText("Asaas")).toBeTruthy();
  });
});

describe("NF-e and NFC-e pages", () => {
  it("NF-e: shows the API example, the lifecycle and the honest test-mode note", async () => {
    const html = renderToStaticMarkup(await NfePage(params("pt")));
    expect(html).toContain("Nota de produto em uma chamada de API.");
    expect(html).toContain("&quot;type&quot;: &quot;nfe&quot;");
    expect(html).toContain("POST /invoices/validate");
    expect(html).toContain("Disponível em teste (homologação). Produção em breve.");
    expect(html).toContain("O mesmo crédito da NFS-e");
    expect(html).not.toContain("Todos os estados");
    expect(html).toContain('href="/pt/docs/nfe"');
    expect(html).toContain('href="/pt/nfc-e"');
  });

  it("NFC-e: shows the receipt, the comparison table and the honest test-mode note", async () => {
    const html = renderToStaticMarkup(await NfcePage(params("pt")));
    expect(html).toContain("O cupom fiscal do seu caixa, sem impressora fiscal.");
    expect(html).toContain("Contingência off-line");
    expect(html).toContain("Disponível em teste (homologação). Produção em breve.");
    expect(html).toContain('<th scope="row"');
    expect(html).toContain('href="/pt/nf-e"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("both have English copy and canonical URLs", async () => {
    expect(renderToStaticMarkup(await NfePage(params("en")))).toContain("Available in test mode (homologação). Production coming soon.");
    expect(renderToStaticMarkup(await NfcePage(params("en")))).toContain("Available in test mode (homologação). Production coming soon.");
    expect((await nfeMeta(params("pt"))).alternates?.canonical).toBe("https://www.corvo.tech/pt/nf-e");
    expect((await nfceMeta(params("en"))).alternates?.canonical).toBe("https://www.corvo.tech/en/nfc-e");
  });
});

describe("routing", () => {
  it("lists the three pages in the sitemap in both languages", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const path of ["integrations", "nf-e", "nfc-e"]) {
      expect(urls).toContain(`https://www.corvo.tech/pt/${path}`);
      expect(urls).toContain(`https://www.corvo.tech/en/${path}`);
    }
  });

  it("a page that is not public still gets the 404 rewrite", () => {
    expect(proxy(new NextRequest("https://www.corvo.tech/pt/nope")).headers.get("x-middleware-rewrite")).toContain("__not-found");
  });

  it.each(["/pt/integrations", "/en/integrations", "/pt/nf-e", "/en/nfc-e"])("%s is public: no redirect to login", (path) => {
    const response = proxy(new NextRequest(`https://www.corvo.tech${path}`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain("__not-found");
  });
});
