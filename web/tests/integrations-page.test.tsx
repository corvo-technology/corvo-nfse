// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntegrationsPage from "@/app/(dashboard)/app/integrations/page";
import NewIntegrationPage from "@/app/(dashboard)/app/integrations/new/page";
import IntegrationDetailPage from "@/app/(dashboard)/app/integrations/[id]/page";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), providers: vi.fn(), create: vi.fn(), validate: vi.fn(), activate: vi.fn(), pause: vi.fn(), disconnect: vi.fn(), putRules: vi.fn(), updateCredentials: vi.fn(), rules: vi.fn(), events: vi.fn(), get: vi.fn(), push: vi.fn(), search: "",
  sales: vi.fn(), completeCustomer: vi.fn(), retry: vi.fn(), companies: vi.fn(), success: vi.fn(), error: vi.fn(), permissions: new Set<string>(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  integrations: { list: mocks.list, providers: mocks.providers, create: mocks.create, validate: mocks.validate, activate: mocks.activate, pause: mocks.pause, disconnect: mocks.disconnect, get: mocks.get, putRules: mocks.putRules, updateCredentials: mocks.updateCredentials, rules: mocks.rules, events: mocks.events, sales: mocks.sales, completeCustomer: mocks.completeCustomer, retry: mocks.retry },
  companies: { list: mocks.companies },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "c1" }), useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams(mocks.search) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (p: string) => mocks.permissions.has(p), fiscalEnvironment: "test" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

const woovi = { id: "woovi", name: "Woovi", version: "1", credentialFields: [{ key: "webhookToken", label: "Webhook token (Authorization header)", secret: true, generate: true, revealOnce: true }], webhookInstructions: { pt: "pt", en: "Create a webhook on Woovi." }, supportedFlows: [] };
const abacate = { id: "abacatepay", name: "AbacatePay", version: "1", credentialFields: [{ key: "apiKey", label: "AbacatePay API key", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true, generate: true, inWebhookUrl: true }], webhookInstructions: { pt: "pt", en: "Create a webhook on AbacatePay." }, supportedFlows: [] };
const pushinpay = { id: "pushinpay", name: "PushinPay", version: "1", credentialFields: [{ key: "webhookSecret", label: "Webhook secret", secret: true, generate: true, inWebhookUrl: true }, { key: "webhookToken", label: "Webhook token (x-corvo-token header)", secret: true, generate: true, revealOnce: true }], webhookInstructions: { pt: "pt", en: "Pass the address as webhook_url and set the x-corvo-token header." }, supportedFlows: [] };
const stripe = { id: "stripe", name: "Stripe", version: "1", credentialFields: [{ key: "apiKey", label: "Stripe restricted key", secret: true }, { key: "webhookSigningSecret", label: "Webhook signing secret", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true, generate: true, inWebhookUrl: true }], webhookInstructions: { pt: "pt", en: "Add a webhook endpoint on Stripe." }, supportedFlows: ["charge"] };
const hotmart = { id: "hotmart", name: "Hotmart", version: "1", credentialFields: [{ key: "hottok", label: "Hotmart hottok", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true, generate: true, inWebhookUrl: true }, { key: "invoiceValue", label: "Valor da nota", secret: false, optional: true, options: ["total", "mine"] }], webhookInstructions: { pt: "pt", en: "Add the webhook on Hotmart, paste your hottok and send a test." }, supportedFlows: ["purchase"] };
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
  mocks.providers.mockResolvedValue([woovi, abacate, pushinpay]);
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
    expect(screen.getAllByText("2 sales need you")).toHaveLength(2);
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

describe("Sales on the list", () => {
  const listWith = (sales: unknown[], connections = [connection()]) => {
    mocks.list.mockResolvedValue(connections);
    mocks.sales.mockResolvedValue(sales);
    renderPage();
  };
  const salesCard = async () => (await screen.findByRole("heading", { name: "Latest sales" })).closest("div")!.parentElement!;

  it("shows the latest sales under the integrations, newest first, with the integration they came from and a link to the invoice", async () => {
    listWith([sale({ id: "old", paidAt: "2026-10-29T10:00:00Z", customer: { name: "Antiga", email: null, taxId: "1", taxIdMasked: false } }), sale({ id: "new", paidAt: "2026-10-29T18:00:00Z", customer: { name: "Recente", email: null, taxId: "1", taxIdMasked: false }, invoiceId: "inv-9" })]);
    const card = await salesCard();
    const names = within(card).getAllByText(/Antiga|Recente/).map((n) => n.textContent);
    expect(names[0]).toMatch(/Recente/);
    expect(within(card).getAllByText(/Woovi · Acme/).length).toBe(2);
    expect(within(card).getAllByText("Invoice issued").length).toBe(2);
    expect(within(card).getAllByRole("link", { name: "View invoice" }).map((a) => a.getAttribute("href"))).toContain("/app/invoices/inv-9");
  });

  it("says everything is fine when no sale needs the client", async () => {
    listWith([sale()]);
    await screen.findByText(/All good: no sale needs you/);
  });

  it("warns about the sales that need the client and filters to them", async () => {
    listWith([sale(), waiting("s2"), waiting("s3")]);
    const banner = await screen.findByRole("status");
    expect(within(banner).getByText("2 sales need you")).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Need attention" }));
    const card = await salesCard();
    expect(within(card).queryByText("Invoice issued")).toBeNull();
    expect(within(card).getAllByText("CPF/CNPJ missing").length).toBe(2);
    expect(within(card).getByRole("button", { name: "Need attention (2)" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(card).getByRole("button", { name: "All" }));
    expect(within(card).getByText("Invoice issued")).toBeTruthy();
  });

  it("a sale whose invoice cancellation was requested shows it with the invoice link; a failed one needs attention and can be retried", async () => {
    mocks.retry.mockResolvedValue({ state: "processed" });
    listWith([sale({ id: "a", blockReason: "cancel_requested", invoiceId: "inv-a" }), sale({ id: "b", fiscalStatus: "needs_attention", blockReason: "cancel_failed", invoiceId: "inv-b", customer: { name: "Bia", email: null, taxId: "1", taxIdMasked: false } })]);
    expect(await screen.findByText("Cancellation requested")).toBeTruthy();
    expect(screen.getByText("Could not cancel the invoice")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "View invoice" }).map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/app/invoices/inv-a", "/app/invoices/inv-b"]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("b"));
    expect(screen.getAllByText("1 sales need you").length).toBeGreaterThan(0);
  });

  it("says so when no sale arrived yet", async () => {
    listWith([]);
    expect(await screen.findByText(/No sales received yet/)).toBeTruthy();
  });

  it("completes the customer document of a waiting sale and issues it, then refreshes", async () => {
    mocks.completeCustomer.mockResolvedValue(sale());
    mocks.retry.mockResolvedValue({ state: "processed" });
    listWith([waiting("s2")]);
    fireEvent.click(await screen.findByRole("button", { name: "Add CPF/CNPJ" }));
    const input = screen.getByLabelText(/Customer CPF or CNPJ/);
    const save = screen.getByRole("button", { name: "Save and issue" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "529.982.247-25" } });
    expect(save.disabled).toBe(false);
    const loads = mocks.list.mock.calls.length;
    fireEvent.click(save);
    await waitFor(() => expect(mocks.completeCustomer).toHaveBeenCalledWith("s2", { taxId: "52998224725" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("s2"));
    expect(mocks.completeCustomer.mock.invocationCallOrder[0]).toBeLessThan(mocks.retry.mock.invocationCallOrder[0]);
    await waitFor(() => expect(mocks.list.mock.calls.length).toBeGreaterThan(loads));
  });

  it("offers a retry for a sale that was held by a paused connection", async () => {
    mocks.retry.mockResolvedValue({ state: "processed" });
    listWith([sale({ fiscalStatus: "blocked", blockReason: "connection_inactive", invoiceId: null })], [connection({ state: "paused" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("s1"));
  });

  it("members without manage permission see the sales but cannot change them", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    listWith([waiting("s2")]);
    await screen.findByText("CPF/CNPJ missing");
    expect(screen.queryByRole("button", { name: "Add CPF/CNPJ" })).toBeNull();
  });

  it("shows no sales section when there is no integration yet", async () => {
    renderPage();
    await screen.findByText("No integrations yet");
    expect(screen.queryByText("Latest sales")).toBeNull();
  });
});

describe("Connect page", () => {
  async function openWoovi() {
    mocks.search = "provider=woovi";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/Company that issues the invoice/);
  }
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
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

  it("connects with just the company and shows the address plus the token to paste in the Authorization header", async () => {
    mocks.create.mockResolvedValue(connection({ state: "draft", secrets: { webhookToken: "tok_123" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    await openWoovi();
    fill();
    expect(screen.queryByLabelText(/Service description/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "woovi", companyId: "co1", environment: "test", credentials: {} }));
    expect(mocks.putRules).toHaveBeenCalledWith("c1", [{ service: {}, sendEmail: true }]);
    expect(screen.getByText("https://api.corvo.tech/v1/integrations/inbound/PUB")).toBeTruthy();
    expect(screen.getByText("Create a webhook on Woovi.")).toBeTruthy();
    expect(screen.getByText("Webhook token (Authorization header)")).toBeTruthy();
    expect(screen.getByText("tok_123")).toBeTruthy();
    expect(screen.getByText(/shown only now/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.push).toHaveBeenCalledWith("/app/integrations");
  });

  it("Woovi asks for nothing but the company, which is already chosen when there is only one", async () => {
    await openWoovi();
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Connect disabled until the credentials the platform asks for are filled", async () => {
    mocks.search = "provider=abacatepay";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/AbacatePay API key/);
    const button = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/AbacatePay API key/), { target: { value: "abc_key" } });
    expect(button.disabled).toBe(false);
  });

  it("explains which step failed, cleans up and never shows the address", async () => {
    mocks.create.mockResolvedValue(connection({ state: "draft" }));
    mocks.validate.mockRejectedValue(new ApiError(422, "Woovi recusou o AppID informado", "ERROR_INTEGRATION_CREDENTIAL_REFUSED"));
    mocks.disconnect.mockResolvedValue(connection({ state: "disconnected" }));
    await openWoovi();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText(new RegExp(`Could not validate the credentials: ${messages.ApiErrors.integration_credential_refused}`));
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
    expect(screen.getByText("Webhook secret")).toBeTruthy();
    expect(screen.getByText(/shown only now/)).toBeTruthy();
  });

  it("PushinPay asks for no credential, shows the generated secret and header token once, and gives the guide", async () => {
    mocks.create.mockResolvedValue(connection({ provider: "pushinpay", state: "draft", webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB?webhookSecret=S3", secrets: { webhookSecret: "S3", webhookToken: "TK9" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    mocks.search = "provider=pushinpay";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/Company that issues the invoice/);
    expect(screen.queryByLabelText(/Webhook token/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "pushinpay", credentials: {} }));
    expect(screen.getByText("TK9")).toBeTruthy();
    expect(screen.getByText("Webhook token (x-corvo-token header)")).toBeTruthy();
    expect(screen.getByText(/set the x-corvo-token header/)).toBeTruthy();
    expect(screen.getByText(/shown only now/)).toBeTruthy();
  });

  it("Stripe asks for the restricted key and the signing secret, generates the URL secret and shows the address only once", async () => {
    mocks.providers.mockResolvedValue([woovi, abacate, stripe]);
    mocks.create.mockResolvedValue(connection({ provider: "stripe", state: "draft", webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB?webhookSecret=S3", secrets: { webhookSecret: "S3" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    mocks.search = "provider=stripe";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/Stripe restricted key/);
    expect(screen.queryByLabelText(/^Webhook secret/)).toBeNull();
    const button = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.change(screen.getByLabelText(/Stripe restricted key/), { target: { value: "rk_live_fake" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Webhook signing secret/), { target: { value: "whsec_fake" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "stripe", credentials: { apiKey: "rk_live_fake", webhookSigningSecret: "whsec_fake" } }));
    expect(screen.getByText(/webhookSecret=S3/)).toBeTruthy();
    expect(screen.getByText("Add a webhook endpoint on Stripe.")).toBeTruthy();
    expect(screen.getByText(/shown only now/)).toBeTruthy();
  });

  it("Hotmart asks for the hottok, offers the invoice amount option (total by default) and shows the guide", async () => {
    mocks.providers.mockResolvedValue([woovi, abacate, stripe, hotmart]);
    mocks.create.mockResolvedValue(connection({ provider: "hotmart", state: "draft", webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB?webhookSecret=S3", secrets: { webhookSecret: "S3" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    mocks.search = "provider=hotmart";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/Hotmart hottok/);
    expect(screen.queryByLabelText(/^Webhook secret/)).toBeNull();
    const option = screen.getByLabelText(/Invoice amount/) as HTMLSelectElement;
    expect(option.value).toBe("total");
    const button = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Hotmart hottok/), { target: { value: "fake-hottok" } });
    expect(button.disabled).toBe(false);
    fireEvent.change(option, { target: { value: "mine" } });
    fireEvent.click(button);
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "hotmart", credentials: { hottok: "fake-hottok", invoiceValue: "mine" } }));
    expect(screen.getByText(/webhookSecret=S3/)).toBeTruthy();
    expect(screen.getByText("Add the webhook on Hotmart, paste your hottok and send a test.")).toBeTruthy();
  });

  it("Hotmart sends the default option when the client does not touch it", async () => {
    mocks.providers.mockResolvedValue([hotmart]);
    mocks.create.mockResolvedValue(connection({ provider: "hotmart", state: "draft", secrets: { webhookSecret: "S3" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    mocks.search = "provider=hotmart";
    wrap(<NewIntegrationPage />);
    await screen.findByLabelText(/Hotmart hottok/);
    fireEvent.change(screen.getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.change(screen.getByLabelText(/Hotmart hottok/), { target: { value: "fake-hottok" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ credentials: { hottok: "fake-hottok", invoiceValue: "total" } }));
  });

  it("lists Hotmart among the platforms with its own description", async () => {
    mocks.providers.mockResolvedValue([woovi, abacate, stripe, hotmart]);
    wrap(<NewIntegrationPage />);
    expect(await screen.findByText("Digital product purchases paid on Hotmart.")).toBeTruthy();
  });

  it("lists Stripe among the platforms with its own description", async () => {
    mocks.providers.mockResolvedValue([woovi, abacate, stripe]);
    wrap(<NewIntegrationPage />);
    expect(await screen.findByText("Card, Pix and boleto paid on Stripe.")).toBeTruthy();
  });

  it("members without manage permission cannot use it", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    wrap(<NewIntegrationPage />);
    await screen.findByText(/ask for the permission/);
    expect(screen.queryByLabelText(/Company that issues the invoice/)).toBeNull();
  });
});

describe("Connection page", () => {
  async function openDetails(sales: unknown[] = [], over: Record<string, unknown> = {}, name = "Woovi") {
    mocks.get.mockResolvedValue(connection(over));
    mocks.sales.mockResolvedValue(sales);
    wrap(<IntegrationDetailPage />);
    await screen.findByRole("heading", { level: 1, name });
  }

  it("shows only what belongs to the integration: settings, connection and disconnect, not the sales", async () => {
    await openDetails([sale(), waiting("s2")]);
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(await screen.findByRole("switch", { name: "Email the invoice to the customer" })).toBeTruthy();
    expect(screen.queryByLabelText(/Service description/)).toBeNull();
    expect(screen.queryByText("Latest sales")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add CPF/CNPJ" })).toBeNull();
    expect(screen.getByText("https://api.corvo.tech/v1/integrations/inbound/PUB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
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
      { externalProductId: null, service: { description: "Consultoria", code: "010101" }, sendEmail: true, allowAnonymousCustomer: true, cancelOnRefund: false },
      { externalProductId: "prod_1", service: { code: "020202" }, sendEmail: false, allowAnonymousCustomer: false },
    ]));
  });

  it("turns on cancelling the invoice on a refund, saves it with the rule, and warns the credit does not come back", async () => {
    mocks.rules.mockResolvedValue([rule({ cancelOnRefund: false })]);
    mocks.putRules.mockResolvedValue([]);
    await openDetails();
    const toggle = await screen.findByRole("switch", { name: "Cancel the invoice on a refund" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/credit is not returned/)).toBeTruthy();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.putRules).toHaveBeenCalledWith("c1", [expect.objectContaining({ externalProductId: null, cancelOnRefund: true })]));
  });

  it("shows the setting as on when the rule has it on, and members who only view cannot change it", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    mocks.rules.mockResolvedValue([rule({ cancelOnRefund: true })]);
    await openDetails();
    const toggle = (await screen.findByRole("switch", { name: "Cancel the invoice on a refund" })) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
  });

  it("a refund notice that is not one of our sales says so in plain words", async () => {
    mocks.events.mockResolvedValue([{ id: "e9", deliveryId: "d9", externalType: "PIX_TRANSACTION_REFUND_SENT_CONFIRMED", state: "ignored", attempts: 1, lastError: "refund_sale_not_found", operationId: null, createdAt: "2026-10-29T16:00:00Z" }]);
    await openDetails();
    expect(await screen.findByText("Refund of a payment that is not a Corvo sale.")).toBeTruthy();
    expect(screen.queryByText("refund_sale_not_found")).toBeNull();
  });

  it("shows how to register the webhook and what each notification was about", async () => {
    mocks.events.mockResolvedValue([
      { id: "e1", deliveryId: "d1", externalType: "checkout.completed", state: "processed", attempts: 1, lastError: null, operationId: "s1", createdAt: "2026-10-29T15:00:00Z" },
    ]);
    await openDetails([sale()]);
    expect(screen.getByText(/Create a webhook on Woovi/)).toBeTruthy();
    expect(await screen.findByText("Processed")).toBeTruthy();
    expect(await screen.findByText(/Maria · .*49[.,]90 · Invoice issued/)).toBeTruthy();
  });

  it("the same payment notified twice is one sale: the old failed notice shows as resolved and the repeat is flagged", async () => {
    mocks.events.mockResolvedValue([
      { id: "e2", deliveryId: "d2", externalType: "checkout.completed", state: "processed", attempts: 1, lastError: null, operationId: "s1", createdAt: "2026-10-29T19:51:31Z" },
      { id: "e1", deliveryId: "d1", externalType: "checkout.completed", state: "needs_attention", attempts: 1, lastError: "customer_tax_id_missing", operationId: "s1", createdAt: "2026-10-29T19:51:27Z" },
    ]);
    await openDetails([sale()]);
    expect(await screen.findByText("Resolved")).toBeTruthy();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText("customer_tax_id_missing")).toBeNull();
    expect(screen.getAllByText(/Maria · /)).toHaveLength(2);
    expect(screen.getAllByText("Same sale as an earlier notification")).toHaveLength(1);
  });

  it("a notice that still needs attention says why, in the words of the sale", async () => {
    mocks.events.mockResolvedValue([
      { id: "e1", deliveryId: "d1", externalType: "checkout.completed", state: "needs_attention", attempts: 1, lastError: "customer_tax_id_missing", operationId: "s2", createdAt: "2026-10-29T15:05:00Z" },
    ]);
    await openDetails([waiting("s2")]);
    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(await screen.findByText(/Joao · .* · CPF\/CNPJ missing/)).toBeTruthy();
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

  it("members without manage permission can read but not change anything", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    await openDetails();
    expect((screen.getByRole("switch", { name: "Issue invoices automatically" }) as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole("switch", { name: "Email the invoice to the customer" });
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("changes the stored key without ever showing the old one, and a connection that needed it works again", async () => {
    mocks.updateCredentials.mockResolvedValue(connection({ state: "active" }));
    await openDetails([], { state: "reauth_required", provider: "abacatepay" }, "AbacatePay");
    expect(screen.getByText(/Stored/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const save = screen.getByRole("button", { name: "Test and save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "  app-new  " } });
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateCredentials).toHaveBeenCalledWith("c1", { apiKey: "app-new" }));
    await waitFor(() => expect(screen.queryByText(/refused the key/)).toBeNull());
    expect(screen.getByRole("switch", { name: "Issue invoices automatically" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows the error and keeps the form open when the platform refuses the new key", async () => {
    mocks.updateCredentials.mockRejectedValue(new ApiError(422, "Woovi recusou o AppID informado", "ERROR_INTEGRATION_CREDENTIAL_REFUSED"));
    await openDetails([], { provider: "abacatepay" }, "AbacatePay");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(messages.ApiErrors.integration_credential_refused));
    expect(screen.getByLabelText("New key")).toBeTruthy();
  });

  it("tells the client to reconnect when the platform refused the credentials", async () => {
    await openDetails([], { state: "reauth_required" });
    expect(screen.getByText(/refused the key/)).toBeTruthy();
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
