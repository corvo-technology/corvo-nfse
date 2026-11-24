// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import { CLOUD_DEFAULT_CONFIG, type DeploymentConfig } from "@/lib/deployment-config";
import BillingLayout from "@/app/(dashboard)/app/billing/layout";
import messages from "@/messages/en.json";

const hoisted = vi.hoisted(() => ({ config: null as unknown, plan: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock("@/lib/deployment-config", async (original) => ({
  ...(await original<typeof import("@/lib/deployment-config")>()),
  fetchDeploymentConfig: () => Promise.resolve(hoisted.config),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  billing: { plan: hoisted.plan },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ can: () => true, tenantId: "t1", fiscalEnvironment: "live" }),
}));

const selfHosted: DeploymentConfig = { deploymentMode: "self_hosted", billingEnabled: false, signupMode: "closed", turnstileSiteKey: null };
const plan = {
  slug: "solo", name: "Solo", monthlyPriceCents: 0,
  subscription: { status: "active", paidUntil: null, cancelAtPeriodEnd: false, scheduledPlan: null, blocked: false, pixSubscription: false },
  usage: { creditsUsed: 1, creditsReserved: 0, creditsRemaining: 9, monthlyAllowance: 10, dailyUsage: 0, dailyLimit: null, activeCompanies: 0, maxActiveCompanies: 1, periodStart: "", periodEnd: "", avulsoBalance: 0 },
};

const renderSidebar = (config?: DeploymentConfig) => {
  const tree = (
    <NextIntlClientProvider locale="en" messages={messages}>
      <Sidebar activePath="/app" open onClose={() => undefined} />
    </NextIntlClientProvider>
  );
  return render(config ? <DeploymentConfigProvider config={config}>{tree}</DeploymentConfigProvider> : tree);
};

beforeEach(() => { hoisted.plan.mockResolvedValue(plan); });
afterEach(() => { cleanup(); hoisted.plan.mockReset(); });

describe("sidebar", () => {
  it("shows plan nav and the credits widget with billing on (and by default)", async () => {
    for (const config of [CLOUD_DEFAULT_CONFIG, undefined]) {
      renderSidebar(config);
      expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toContain("/app/billing");
      expect(await screen.findByTestId("notes-available")).toBeTruthy();
      expect(screen.queryByText("Self-hosted")).toBeNull();
      cleanup();
    }
  });

  it("hides billing nav and credits, never asks for the plan, and shows Self-hosted when billing is off", async () => {
    renderSidebar(selfHosted);
    await Promise.resolve();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).not.toContain("/app/billing");
    expect(screen.queryByTestId("notes-available")).toBeNull();
    expect(screen.getByText("Self-hosted")).toBeTruthy();
    expect(hoisted.plan).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toContain("/app/settings");
  });
});

describe("billing route layout", () => {
  it("lets the page through with billing on", async () => {
    hoisted.config = CLOUD_DEFAULT_CONFIG;
    const element = await BillingLayout({ children: <p>billing page</p> });
    expect(element).toBeTruthy();
  });

  it("redirects to /app with billing off", async () => {
    hoisted.config = selfHosted;
    await expect(BillingLayout({ children: <p>billing page</p> })).rejects.toThrow("REDIRECT:/app");
  });
});
