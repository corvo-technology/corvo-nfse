// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GettingStartedBanner } from "@/components/dashboard/getting-started-banner";
import messages from "@/messages/pt.json";

const api = vi.hoisted(() => ({ companies: vi.fn(), certs: vi.fn(), invoices: vi.fn(), dps: vi.fn(), env: "live" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ tenantId: "t1", fiscalEnvironment: api.env, can: () => true }) }));
vi.mock("@/lib/api", () => ({ companies: { list: api.companies, dpsSequence: api.dps }, certificates: { list: api.certs }, invoices: { list: api.invoices } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const page = (items: unknown[]) => ({ items });
const renderBanner = () => render(<NextIntlClientProvider locale="pt" messages={messages}><GettingStartedBanner /></NextIntlClientProvider>);
const go = () => screen.getByRole("link", { name: /Ir/ }).getAttribute("href");
const company = () => api.companies.mockResolvedValue(page([{ id: "c1", createdAt: "2026-01-01" }]));

beforeEach(() => { api.env = "live"; api.companies.mockReset(); api.certs.mockReset(); api.invoices.mockReset(); api.dps.mockReset(); api.dps.mockResolvedValue({ series: "1", lastNumber: 0 }); localStorage.clear(); });
afterEach(cleanup);

describe("GettingStartedBanner", () => {
  it("shows 0 de 4 and points to the company for a new account", async () => {
    api.companies.mockResolvedValue(page([]));
    api.invoices.mockResolvedValue(page([]));
    renderBanner();
    await screen.findByText("0 de 4");
    expect(screen.getByText("Próximo: cadastrar a empresa")).toBeTruthy();
    expect(go()).toBe("/app/companies?new=1");
  });

  it("points to the company certificate when only the company exists", async () => {
    company();
    api.certs.mockResolvedValue(page([{ status: "expired" }]));
    api.invoices.mockResolvedValue(page([]));
    renderBanner();
    await screen.findByText("1 de 4");
    expect(screen.getByText("Próximo: enviar o certificado")).toBeTruthy();
    expect(go()).toBe("/app/companies/c1#certificado");
  });

  it("points to the numbering after company and certificate, asking only for authorized invoices", async () => {
    company();
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    api.invoices.mockResolvedValue(page([]));
    renderBanner();
    await screen.findByText("2 de 4");
    expect(screen.getByText("Próximo: informar a numeração")).toBeTruthy();
    expect(go()).toBe("/app/companies/c1#numeracao");
    expect(api.invoices).toHaveBeenCalledWith({ status: "authorized", limit: 1 }, expect.anything());
  });

  it("moves to the first invoice when the numbering sequence already moved", async () => {
    company();
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    api.invoices.mockResolvedValue(page([]));
    api.dps.mockResolvedValue({ series: "1", lastNumber: 57 });
    renderBanner();
    await screen.findByText("3 de 4");
    expect(screen.getByText("Próximo: emitir a primeira nota")).toBeTruthy();
    expect(go()).toBe("/app/invoices/new");
  });

  it("marks numbering done with \"Nunca emiti\" and remembers it per company", async () => {
    company();
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    api.invoices.mockResolvedValue(page([]));
    renderBanner();
    await screen.findByText("2 de 4");
    fireEvent.click(screen.getByRole("button", { name: "Nunca emiti" }));
    expect(screen.getByText("3 de 4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nunca emiti" })).toBeNull();
    expect(localStorage.getItem("corvo:onboarding:t1:dpsSkipped:c1")).toBe("1");
    cleanup();
    renderBanner();
    await screen.findByText("3 de 4");
  });

  it("counts numbering as done when a live note exists", async () => {
    company();
    api.certs.mockResolvedValue(page([]));
    api.invoices.mockResolvedValue(page([{ id: "i1" }]));
    renderBanner();
    await screen.findByText("3 de 4");
    expect(screen.getByText("Próximo: enviar o certificado")).toBeTruthy();
  });

  it("does not count production invoices while in the test environment", async () => {
    api.env = "test";
    company();
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    renderBanner();
    await screen.findByText("2 de 4");
    expect(api.invoices).not.toHaveBeenCalled();
  });

  it("is hidden when all steps are done", async () => {
    company();
    api.certs.mockResolvedValue(page([{ status: "active" }]));
    api.invoices.mockResolvedValue(page([{ id: "i1" }]));
    renderBanner();
    await waitFor(() => expect(api.invoices).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });
});
