// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserDetailPage from "@/app/(dashboard)/app/admin/users/[id]/page";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import { CLOUD_DEFAULT_CONFIG } from "@/lib/deployment-config";
import { ApiError } from "@/lib/api";
import type { PlatformUserDetail, PlatformWorkspace } from "@/lib/platform-admin";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ user: vi.fn(), grantProps: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "u-1" }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/platform-admin", async (original) => ({
  ...(await original<typeof import("@/lib/platform-admin")>()),
  platformAdmin: { user: mocks.user },
}));
vi.mock("@/components/admin/grant-credits-button", () => ({
  GrantCreditsButton: (props: { tenantId: string; email: string; onGranted: () => void }) => {
    mocks.grantProps(props);
    return <button onClick={props.onGranted}>grant-{props.tenantId}</button>;
  },
}));

const t = messages.Admin.detail;

function workspace(over: Partial<PlatformWorkspace> = {}): PlatformWorkspace {
  return {
    tenantId: "t-own", role: "owner", isOwn: true, plan: { slug: "pro", name: "Pro Plan" },
    usage: { included: 100, authorized: 40, reserved: 2, periodEnd: "2026-12-01T00:00:00Z" }, avulsoBalance: 7,
    companies: [{ id: "c1", taxId: "12345678000190", legalName: "Acme Ltda", municipalityCode: "3550308", environment: "live", certificateValidUntil: "2027-03-10T00:00:00Z" }],
    recentInvoices: [{ id: "i1", status: "rejected", amount: 150.5, environment: "live", lastErrorCode: "CODE_X", createdAt: "2026-11-20T10:00:00Z" }],
    credits: [{ id: "cr1", type: "bonus", source: "bonus", amount: 5, description: "gift", createdAt: "2026-11-19T10:00:00Z" }],
    payments: [{ id: "p1", kind: "plan", provider: "stripe", amountCents: 9900, status: "paid", paidAt: "2026-11-01T10:00:00Z" }],
    apiKeys: [{ id: "k1", name: "Prod key", keyPrefix: "cv_live_ab12", environment: "live", lastUsedAt: null }],
    mcpConnections: [{ id: "m1", clientName: "Claude Desktop", lastUsedAt: "2026-11-18T10:00:00Z" }],
    ...over,
  };
}
function detail(workspaces: PlatformWorkspace[] = [workspace()]): PlatformUserDetail {
  return { user: { id: "u-1", email: "ana@example.com", name: "Ana", emailVerifiedAt: "2026-10-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", lastLoginAt: null }, workspaces };
}
function setup(billingEnabled = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeploymentConfigProvider config={{ ...CLOUD_DEFAULT_CONFIG, billingEnabled }}>
        <UserDetailPage />
      </DeploymentConfigProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { mocks.user.mockResolvedValue(detail()); });
afterEach(() => { cleanup(); mocks.user.mockReset(); mocks.grantProps.mockReset(); });

describe("admin user detail page", () => {
  it("mostra a conta e um bloco por workspace com tudo", async () => {
    mocks.user.mockResolvedValue(detail([workspace(), workspace({ tenantId: "t-other", isOwn: false, role: "admin", plan: null, usage: null })]));
    setup();
    await screen.findByText("ana@example.com");
    expect(mocks.user).toHaveBeenCalledWith("u-1", expect.anything());
    expect(screen.getByText(t.lastLogin).nextElementSibling?.textContent).toBe(messages.Admin.common.never);
    expect(screen.getByText(t.emailVerified).nextElementSibling?.textContent).not.toBe(messages.Admin.common.no);
    const blocks = screen.getAllByRole("region");
    expect(blocks).toHaveLength(2);
    const own = within(blocks[0]);
    expect(own.getByText("owner")).toBeTruthy();
    expect(own.getByText("Pro Plan")).toBeTruthy();
    expect(own.getByText(/40/)).toBeTruthy();
    expect(own.getByText("12345678000190")).toBeTruthy();
    expect(own.getByText("3550308")).toBeTruthy();
    expect(own.getByText("Acme Ltda")).toBeTruthy();
    expect(own.getByText(/CODE_X/)).toBeTruthy();
    expect(own.getByText("gift")).toBeTruthy();
    expect(own.getByText("stripe")).toBeTruthy();
    expect(own.getByText("cv_live_ab12")).toBeTruthy();
    expect(own.getByText("Claude Desktop")).toBeTruthy();
  });

  it("dá o botão de notas ao workspace próprio com tenantId e e-mail, e recarrega ao conceder", async () => {
    mocks.user.mockResolvedValue(detail([workspace({ tenantId: "t-other", isOwn: false }), workspace()]));
    setup();
    await screen.findByText("ana@example.com");
    expect(mocks.grantProps).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t-own", email: "ana@example.com" }));
    expect(screen.queryByText("grant-t-other")).toBeNull();
    expect(mocks.user).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("grant-t-own"));
    await waitFor(() => expect(mocks.user).toHaveBeenCalledTimes(2));
  });

  it("404 mostra Admin.common.notFound", async () => {
    mocks.user.mockRejectedValue(new ApiError(404, "nope", "RESOURCE_NOT_FOUND"));
    setup();
    expect(await screen.findByText(messages.Admin.common.notFound)).toBeTruthy();
  });

  it("self-hosted esconde créditos, pagamentos, plano e botão", async () => {
    setup(false);
    await screen.findByText("ana@example.com");
    expect(screen.queryByText(t.credits)).toBeNull();
    expect(screen.queryByText(t.payments)).toBeNull();
    expect(screen.queryByText(t.plan)).toBeNull();
    expect(screen.queryByText("Pro Plan")).toBeNull();
    expect(screen.queryByText(t.balance)).toBeNull();
    expect(screen.queryByText(/grant-/)).toBeNull();
    expect(screen.getByText("Acme Ltda")).toBeTruthy();
  });
});
