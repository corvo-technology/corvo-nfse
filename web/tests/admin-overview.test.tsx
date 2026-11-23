// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminOverviewPage from "@/app/(dashboard)/app/admin/page";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import { CLOUD_DEFAULT_CONFIG } from "@/lib/deployment-config";
import { formatDate } from "@/lib/i18n-helpers";
import type { PlatformOverview } from "@/lib/platform-admin";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock("@/lib/platform-admin", async (original) => ({
  ...(await original<typeof import("@/lib/platform-admin")>()),
  platformAdmin: { overview: mocks.overview },
}));

const t = messages.Admin.overview;
const SINCE = "2026-11-10T12:00:00.000Z";
const win = (authorized: number, rejected: number, rejectionRate: number | null) => ({ authorized, rejected, rejectionRate });
const data = (since: string | null = SINCE): PlatformOverview => ({
  users: { total: 321, new7d: 7, new30d: 30 },
  invoices: {
    live: { today: win(11, 1, 0.0833), d7: win(70, 5, 0.0667), d30: win(300, 30, 0.0909) },
    test: { today: win(2, 0, 0), d7: win(3, 0, 0), d30: win(4, 0, null) },
  },
  revenue: {
    d7: { subscriptionCents: 10000, avulsoCents: 2500, totalCents: 12500 },
    d30: { subscriptionCents: 40000, avulsoCents: 9000, totalCents: 49000 },
    stripeRecordedSince: since,
  },
  adminGrants: { units7d: 15, units30d: 88 },
});

function setup(billingEnabled = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeploymentConfigProvider config={{ ...CLOUD_DEFAULT_CONFIG, billingEnabled }}>
        <AdminOverviewPage />
      </DeploymentConfigProvider>
    </NextIntlClientProvider>,
  );
}
const section = (title: string) => within(screen.getByRole("region", { name: title }));

afterEach(() => { cleanup(); mocks.overview.mockReset(); });

describe("admin overview page", () => {
  it("mostra os totais de usuários", async () => {
    mocks.overview.mockResolvedValue(data());
    setup();
    await waitFor(() => expect(screen.getByRole("region", { name: t.users })).toBeTruthy());
    const users = section(t.users);
    expect(users.getByText("321")).toBeTruthy();
    expect(users.getByText(t.usersNew7d)).toBeTruthy();
    expect(users.getByText("7")).toBeTruthy();
    expect(users.getByText("30")).toBeTruthy();
  });

  it("mostra as três janelas de notas de produção, com a taxa em %", async () => {
    mocks.overview.mockResolvedValue(data());
    setup();
    await waitFor(() => expect(screen.getByRole("region", { name: t.invoicesLive })).toBeTruthy());
    const live = section(t.invoicesLive);
    expect(live.getByText(t.today)).toBeTruthy();
    expect(live.getByText(t.last7d)).toBeTruthy();
    expect(live.getByText(t.last30d)).toBeTruthy();
    expect(live.getAllByText(t.authorized)).toHaveLength(3);
    expect(live.getAllByText(t.rejected)).toHaveLength(3);
    expect(live.getByText("70")).toBeTruthy();
    expect(live.getByText("8.3%")).toBeTruthy();
    expect(live.getByText("6.7%")).toBeTruthy();
    expect(live.getByText("9.1%")).toBeTruthy();
  });

  it("mostra as notas de teste em bloco separado, e taxa nula como traço", async () => {
    mocks.overview.mockResolvedValue(data());
    setup();
    await waitFor(() => expect(screen.getByRole("region", { name: t.invoicesTest })).toBeTruthy());
    const test = section(t.invoicesTest);
    expect(test.getByText("4")).toBeTruthy();
    expect(test.getByText("—")).toBeTruthy();
    expect(section(t.invoicesLive).queryByText("4")).toBeNull();
  });

  it("mostra a receita em R$ com assinatura, avulso e total, e a data da nota", async () => {
    mocks.overview.mockResolvedValue(data());
    setup();
    await waitFor(() => expect(screen.getByRole("region", { name: t.revenue })).toBeTruthy());
    const revenue = section(t.revenue);
    for (const amount of ["490", "125", "400", "90"]) {
      expect(revenue.getByText(new RegExp(`^R\\$\\s?${amount}[.,]00$`))).toBeTruthy();
    }
    for (const label of [t.revenueSubscription, t.revenueAvulso, t.revenueTotal]) {
      expect(revenue.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(revenue.getByText(t.revenueNote.replace("{date}", formatDate(SINCE, "en")))).toBeTruthy();
  });

  it("sem data de início das assinaturas mostra a nota alternativa", async () => {
    mocks.overview.mockResolvedValue(data(null));
    setup();
    await waitFor(() => expect(screen.getByText(t.revenueNoteNone)).toBeTruthy());
  });

  it("mostra as notas dadas pelo admin e que não são receita", async () => {
    mocks.overview.mockResolvedValue(data());
    setup();
    await waitFor(() => expect(screen.getByRole("region", { name: t.adminGrants })).toBeTruthy());
    const grants = section(t.adminGrants);
    expect(grants.getByText(t.units.replace("{count}", "88"))).toBeTruthy();
    expect(grants.getByText(t.units.replace("{count}", "15"))).toBeTruthy();
    expect(grants.getByText(t.adminGrantsNote)).toBeTruthy();
  });

  it("sem cobrança (self-hosted) esconde a receita e as notas dadas", async () => {
    mocks.overview.mockResolvedValue(data());
    setup(false);
    await waitFor(() => expect(screen.getByText("321")).toBeTruthy());
    expect(screen.queryByRole("region", { name: t.revenue })).toBeNull();
    expect(screen.queryByRole("region", { name: t.adminGrants })).toBeNull();
    expect(screen.queryByText(t.revenueNoteNone)).toBeNull();
    expect(screen.getByRole("region", { name: t.invoicesLive })).toBeTruthy();
  });

  it("erro de API mostra a mensagem de falha", async () => {
    mocks.overview.mockRejectedValue(new Error("boom"));
    setup();
    await waitFor(() => expect(screen.getByText(messages.Admin.common.loadFailed)).toBeTruthy());
  });
});
