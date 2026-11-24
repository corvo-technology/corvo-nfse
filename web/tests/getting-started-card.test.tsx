// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GettingStartedCard } from "@/components/dashboard/getting-started-card";
import messages from "@/messages/pt.json";

const api = vi.hoisted(() => ({ companies: vi.fn(), certs: vi.fn(), invoices: vi.fn(), env: "live" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ tenantId: "t1", fiscalEnvironment: api.env, can: () => true }) }));
vi.mock("@/lib/api", () => ({ companies: { list: api.companies }, certificates: { list: api.certs }, invoices: { list: api.invoices } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const page = (items: unknown[]) => ({ items });
const renderCard = () => render(<NextIntlClientProvider locale="pt" messages={messages}><GettingStartedCard /></NextIntlClientProvider>);
const rows = () => screen.getAllByRole("listitem").map((li) => li.getAttribute("data-done"));

beforeEach(() => { api.env = "live"; api.companies.mockReset(); api.certs.mockReset(); api.invoices.mockReset(); });
afterEach(cleanup);

describe("GettingStartedCard", () => {
  it("shows all three steps pending for a new account", async () => {
    api.companies.mockResolvedValue(page([]));
    api.invoices.mockResolvedValue(page([]));
    renderCard();
    await screen.findByText("Comece por aqui");
    expect(rows()).toEqual(["false", "false", "false"]);
    expect(screen.getByRole("link", { name: "Cadastrar" }).getAttribute("href")).toBe("/app/companies");
  });

  it("marks company done and links the certificate to the company", async () => {
    api.companies.mockResolvedValue(page([{ id: "c1", createdAt: "2026-01-01" }]));
    api.certs.mockResolvedValue(page([{ status: "expired" }]));
    api.invoices.mockResolvedValue(page([]));
    renderCard();
    await screen.findByText("Comece por aqui");
    expect(rows()).toEqual(["true", "false", "false"]);
    expect(screen.getByRole("link", { name: "Enviar" }).getAttribute("href")).toBe("/app/companies/c1");
  });

  it("marks company and certificate from real data and asks only for authorized invoices", async () => {
    api.companies.mockResolvedValue(page([{ id: "c1", createdAt: "2026-01-01" }]));
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    api.invoices.mockResolvedValue(page([]));
    renderCard();
    await screen.findByText("Comece por aqui");
    expect(rows()).toEqual(["true", "true", "false"]);
    expect(api.invoices).toHaveBeenCalledWith({ status: "authorized", limit: 1 }, expect.anything());
  });

  it("hides the card when all three are done", async () => {
    api.companies.mockResolvedValue(page([{ id: "c1", createdAt: "2026-01-01" }]));
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    api.invoices.mockResolvedValue(page([{ id: "i1" }]));
    renderCard();
    await waitFor(() => expect(api.invoices).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Comece por aqui")).toBeNull();
  });

  it("does not count production invoices while in the test environment", async () => {
    api.env = "test";
    api.companies.mockResolvedValue(page([{ id: "c1", createdAt: "2026-01-01" }]));
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    renderCard();
    await screen.findByText("Comece por aqui");
    expect(api.invoices).not.toHaveBeenCalled();
    expect(rows()).toEqual(["true", "true", "false"]);
  });
});
