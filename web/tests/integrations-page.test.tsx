// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntegrationsPage from "@/app/(dashboard)/app/integrations/page";
import NewIntegrationPage from "@/app/(dashboard)/app/integrations/new/page";
import IntegrationDetailPage from "@/app/(dashboard)/app/integrations/[id]/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), providers: vi.fn(), create: vi.fn(), validate: vi.fn(), activate: vi.fn(), pause: vi.fn(), disconnect: vi.fn(), putRules: vi.fn(), rules: vi.fn(), events: vi.fn(), get: vi.fn(), push: vi.fn(), search: "",
  sales: vi.fn(), completeCustomer: vi.fn(), retry: vi.fn(), companies: vi.fn(), success: vi.fn(), error: vi.fn(), permissions: new Set<string>(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  integrations: { list: mocks.list, providers: mocks.providers, create: mocks.create, validate: mocks.validate, activate: mocks.activate, pause: mocks.pause, disconnect: mocks.disconnect, get: mocks.get, putRules: mocks.putRules, rules: mocks.rules, events: mocks.events, sales: mocks.sales, completeCustomer: mocks.completeCustomer, retry: mocks.retry },
  companies: { list: mocks.companies },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "c1" }), useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams(mocks.search) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (p: string) => mocks.permissions.has(p), fiscalEnvironment: "test" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

const woovi = { id: "woovi", name: "Woovi", version: "1", credentialFields: [{ key: "appId", label: "AppID", secret: true }], webhookInstructions: { pt: "pt", en: "Create a webhook on Woovi." }, supportedFlows: [] };
const abacate = { id: "abacatepay", name: "AbacatePay", version: "1", credentialFields: [{ key: "apiKey", label: "AbacatePay API key", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true, generate: true, inWebhookUrl: true }], webhookInstructions: { pt: "pt", en: "Create a webhook on AbacatePay." }, supportedFlows: [] };
const company = { id: "co1", legalName: "Acme Ltda", tradeName: "Acme" };
const connection = (over: Record<string, unknown> = {}) => ({ id: "c1", provider: "woovi", environment: "test", companyId: "co1", state: "active", externalAccountId: "acc", activeFrom: null, webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB", createdAt: "2026-10-29T12:00:00Z", ...over });
const sale = (over: Record<string, unknown> = {}) => ({ id: "s1", operationKey: "charge:1", commercialState: "paid", fiscalStatus: "submitted", blockReason: null, amountCents: 4990, currency: "BRL", customer: { name: "Maria", email: null, taxId: "52998224725", taxIdMasked: false }, paidAt: "2026-10-29T15:00:00Z", invoiceId: "inv1", createdAt: "2026-10-29T15:00:00Z", updatedAt: "2026-10-29T15:00:00Z", ...over });
const waiting = (id: string) => sale({ id, fiscalStatus: "needs_attention", blockReason: "customer_tax_id_missing", invoiceId: null, customer: { name: "Joao", email: null, taxId: null, taxIdMasked: true } });
const rule = (over: Record<string, unknown> = {}) => ({ id: "r1", externalProductId: null, service: { description: "Consultoria" }, sendEmail: true, allowAnonymousCustomer: false, ...over });
const wrap = (page: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{page}</NextIntlClientProvider>);
const renderPage = () => wrap(<IntegrationsPage />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(["integrations.view", "integrations.manage"]);
  mocks.search = "";
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue(connection());
  mocks.providers.mockResolvedValue([woovi, abacate]);
  mocks.companies.mockResolvedValue({ items: [company], hasMore: false, nextCursor: null });
  mocks.sales.mockResolvedValue([]);
  mocks.rules.mockResolvedValue([rule()]);
  mocks.events.mockResolvedValue([]);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(cleanup);

const hrefOf = (element: HTMLElement) => element.closest("a")?.getAttribute("href");

describe("Integrations list", () => {
  it("offers the platforms right in the empty state, each a link to the connect page", async () => {
    renderPage();
    await screen.findByText("No integrations yet");
    expect(hrefOf(screen.getByText("Woovi"))).toBe("/app/integrations/new?provider=woovi");
    expect(hrefOf(screen.getByText("AbacatePay"))).toBe("/app/integrations/new?provider=abacatepay");
  });

  it("lists connections as links to their page, with company, status and how many sales need the client", async () => {
    mocks.list.mockResolvedValue([connection()]);
    mocks.sales.mockResolvedValue([sale(), waiting("s2"), waiting("s3")]);
    renderPage();
    const name = await screen.findByText("Woovi");
    expect(hrefOf(name)).toBe("/app/integrations/c1");
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("2 sales need you")).toBeTruthy();
    expect(hrefOf(screen.getByText("Connect"))).toBe("/app/integrations/new");
  });

  it("hides disconnected connections and connections of the other environment", async () => {
    mocks.list.mockResolvedValue([connection({ state: "disconnected" }), connection({ id: "c2", environment: "live" })]);
    renderPage();
    await screen.findByText("No integrations yet");
  });

  it("members without manage permission see no connect links", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    renderPage();
    await screen.findByText("No integrations yet");
    expect(screen.queryByText("Connect")).toBeNull();
    expect(screen.queryByText("Woovi")).toBeNull();
  });

  it("shows an error with a retry when loading fails", async () => {
    mocks.list.mockRejectedValueOnce(new Error("down"));
    renderPage();
    await screen.findByText("Could not load integrations.");
    mocks.list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("No integrations yet");
  });
});

describe("Connect page", () => {
  async function openWoovi() {
    mocks.search = "provider=woovi";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/AppID/);
  }
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.change(screen.getByLabelText(/AppID/), { target: { value: "app-123" } });
  };

  it("opens straight on the details of the chosen platform", async () => {
    await openWoovi();
    expect(screen.getByLabelText(/Company that issues the invoice/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("without a platform, starts by choosing one and can go back", async () => {
    wrap(<NewIntegrationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /AbacatePay/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Woovi/ })).toBeTruthy();
  });

  it("connects in one click and shows the webhook address to register", async () => {
    mocks.create.mockResolvedValue(connection({ state: "draft" }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    await openWoovi();
    fill();
    expect(screen.queryByLabelText(/Service description/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "woovi", companyId: "co1", environment: "test", credentials: { appId: "app-123" } }));
    expect(mocks.putRules).toHaveBeenCalledWith("c1", [{ service: {}, sendEmail: true }]);
    expect(screen.getByText("https://api.corvo.tech/v1/integrations/inbound/PUB")).toBeTruthy();
    expect(screen.getByText("Create a webhook on Woovi.")).toBeTruthy();
    expect(screen.queryByText(/contains a secret/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.push).toHaveBeenCalledWith("/app/integrations");
  });

  it("keeps Connect disabled until the company and the credentials are filled", async () => {
    await openWoovi();
    const button = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fill();
    expect(button.disabled).toBe(false);
  });

  it("explains which step failed, cleans up and never shows the address", async () => {
    mocks.create.mockResolvedValue(connection({ state: "draft" }));
    mocks.validate.mockRejectedValue(new Error("Woovi recusou o AppID informado"));
    mocks.disconnect.mockResolvedValue(connection({ state: "disconnected" }));
    await openWoovi();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText(/Could not validate the credentials: Woovi recusou o AppID informado/);
    expect(mocks.disconnect).toHaveBeenCalledWith("c1");
    expect(screen.queryByText("Connected!")).toBeNull();
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("AbacatePay asks for the API key, generates the webhook secret and warns that the secret in the address is shown only once", async () => {
    mocks.create.mockResolvedValue(connection({ provider: "abacatepay", state: "draft", webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB?webhookSecret=S3", secrets: { webhookSecret: "S3" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    mocks.search = "provider=abacatepay";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/AbacatePay API key/);
    expect(screen.queryByLabelText(/Webhook secret/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.change(screen.getByLabelText(/AbacatePay API key/), { target: { value: "abc_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ credentials: { apiKey: "abc_key" } }));
    expect(screen.getByText(/webhookSecret=S3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the secret" })).toBeTruthy();
    expect(screen.getByText(/Also paste it into the webhook/)).toBeTruthy();
    expect(screen.getByText(/contains a secret/)).toBeTruthy();
  });

  it("members without manage permission cannot use it", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    wrap(<NewIntegrationPage />);
    await screen.findByText(/ask for the permission/);
    expect(screen.queryByLabelText(/AppID/)).toBeNull();
  });
});

describe("Connection page", () => {
  async function openDetails(sales: unknown[] = [], over: Record<string, unknown> = {}) {
    mocks.get.mockResolvedValue(connection(over));
    mocks.sales.mockResolvedValue(sales);
    wrap(<IntegrationDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Woovi" });
  }

  it("shows everything on one page: settings, sales, connection and disconnect", async () => {
    await openDetails([sale(), waiting("s2")]);
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(await screen.findByRole("switch", { name: "Email the invoice to the customer" })).toBeTruthy();
    expect(screen.queryByLabelText(/Service description/)).toBeNull();
    expect(await screen.findByText("Invoice issued")).toBeTruthy();
    expect(screen.getByText("CPF/CNPJ missing")).toBeTruthy();
    expect(screen.getByText("https://api.corvo.tech/v1/integrations/inbound/PUB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("says so when no sale arrived yet", async () => {
    await openDetails([]);
    expect(await screen.findByText(/No sales received yet/)).toBeTruthy();
  });

  it("turns issuing off and on with the switch", async () => {
    mocks.pause.mockResolvedValue(connection({ state: "paused" }));
    mocks.activate.mockResolvedValue(connection({ state: "active" }));
    await openDetails();
    const toggle = screen.getByRole("switch", { name: "Issue invoices automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Issue invoices automatically" }).getAttribute("aria-checked")).toBe("false"));
    fireEvent.click(screen.getByRole("switch", { name: "Issue invoices automatically" }));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("c1"));
  });

  it("edits the default rule, keeps a description set through the API and leaves the per-product rules untouched", async () => {
    mocks.rules.mockResolvedValue([rule({ service: { description: "Consultoria", code: "010101" } }), rule({ id: "r2", externalProductId: "prod_1", service: { code: "020202" }, sendEmail: false })]);
    mocks.putRules.mockResolvedValue([]);
    await openDetails();
    await screen.findByRole("switch", { name: "Email the invoice to the customer" });
    expect(screen.getByText(/1 per-product rule/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Issue even without the customer's CPF/CNPJ" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.putRules).toHaveBeenCalledWith("c1", [
      { externalProductId: null, service: { description: "Consultoria", code: "010101" }, sendEmail: true, allowAnonymousCustomer: true },
      { externalProductId: "prod_1", service: { code: "020202" }, sendEmail: false, allowAnonymousCustomer: false },
    ]));
  });

  it("shows how to register the webhook and the notifications received", async () => {
    mocks.events.mockResolvedValue([
      { id: "e1", deliveryId: "d1", externalType: "checkout.completed", state: "processed", attempts: 1, lastError: null, operationId: "o1", createdAt: "2026-10-29T15:00:00Z" },
      { id: "e2", deliveryId: "d2", externalType: "checkout.completed", state: "needs_attention", attempts: 1, lastError: "customer_tax_id_missing", operationId: "o2", createdAt: "2026-10-29T15:05:00Z" },
    ]);
    await openDetails();
    expect(screen.getByText(/Create a webhook on Woovi/)).toBeTruthy();
    expect(await screen.findByText("Processed")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("customer_tax_id_missing")).toBeTruthy();
  });

  it("asks for confirmation before disconnecting for good, then goes back to the list", async () => {
    mocks.disconnect.mockResolvedValue(connection({ state: "disconnected" }));
    await openDetails();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(mocks.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/integrations"));
  });

  it("completes the customer document of a waiting sale and issues it", async () => {
    mocks.completeCustomer.mockResolvedValue(sale());
    mocks.retry.mockResolvedValue({ state: "processed" });
    await openDetails([waiting("s2")]);
    fireEvent.click(await screen.findByRole("button", { name: "Add CPF/CNPJ" }));
    const input = screen.getByLabelText(/Customer CPF or CNPJ/);
    const save = screen.getByRole("button", { name: "Save and issue" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "529.982.247-25" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.completeCustomer).toHaveBeenCalledWith("s2", { taxId: "52998224725" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("s2"));
    expect(mocks.completeCustomer.mock.invocationCallOrder[0]).toBeLessThan(mocks.retry.mock.invocationCallOrder[0]);
  });

  it("offers a retry for a sale that was held by a paused connection", async () => {
    mocks.retry.mockResolvedValue({ state: "processed" });
    await openDetails([sale({ fiscalStatus: "blocked", blockReason: "connection_inactive", invoiceId: null })]);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("s1"));
  });

  it("members without manage permission can read but not change anything", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    await openDetails([waiting("s2")]);
    await screen.findByText("CPF/CNPJ missing");
    expect((screen.getByRole("switch", { name: "Issue invoices automatically" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Add CPF/CNPJ" })).toBeNull();
    await screen.findByRole("switch", { name: "Email the invoice to the customer" });
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("tells the client to reconnect when the platform refused the credentials", async () => {
    await openDetails([], { state: "reauth_required" });
    expect(screen.getByText(/refused the credentials/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Issue invoices automatically" })).toBeNull();
  });

  it("shows an error with a retry when the connection cannot be loaded", async () => {
    mocks.get.mockRejectedValueOnce(new Error("down"));
    wrap(<IntegrationDetailPage />);
    await screen.findByText("Could not load integrations.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: "Woovi" });
  });
});
