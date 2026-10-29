// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntegrationsPage from "@/app/(dashboard)/app/integrations/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), providers: vi.fn(), create: vi.fn(), validate: vi.fn(), activate: vi.fn(), pause: vi.fn(), disconnect: vi.fn(), putRules: vi.fn(),
  sales: vi.fn(), completeCustomer: vi.fn(), retry: vi.fn(), companies: vi.fn(), success: vi.fn(), error: vi.fn(), permissions: new Set<string>(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  integrations: { list: mocks.list, providers: mocks.providers, create: mocks.create, validate: mocks.validate, activate: mocks.activate, pause: mocks.pause, disconnect: mocks.disconnect, putRules: mocks.putRules, sales: mocks.sales, completeCustomer: mocks.completeCustomer, retry: mocks.retry },
  companies: { list: mocks.companies },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (p: string) => mocks.permissions.has(p), fiscalEnvironment: "test" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

const woovi = { id: "woovi", name: "Woovi", version: "1", credentialFields: [{ key: "appId", label: "AppID", secret: true }], webhookInstructions: { pt: "pt", en: "Create a webhook on Woovi." }, supportedFlows: [] };
const abacate = { id: "abacatepay", name: "AbacatePay", version: "1", credentialFields: [{ key: "apiKey", label: "AbacatePay API key", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true, generate: true, inWebhookUrl: true }], webhookInstructions: { pt: "pt", en: "Create a webhook on AbacatePay." }, supportedFlows: [] };
const company = { id: "co1", legalName: "Acme Ltda", tradeName: "Acme" };
const connection = (over: Record<string, unknown> = {}) => ({ id: "c1", provider: "woovi", environment: "test", companyId: "co1", state: "active", externalAccountId: "acc", activeFrom: null, webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB", createdAt: "2026-10-29T12:00:00Z", ...over });
const sale = (over: Record<string, unknown> = {}) => ({ id: "s1", operationKey: "charge:1", commercialState: "paid", fiscalStatus: "submitted", blockReason: null, amountCents: 4990, currency: "BRL", customer: { name: "Maria", email: null, taxId: "52998224725", taxIdMasked: false }, paidAt: "2026-10-29T15:00:00Z", invoiceId: "inv1", createdAt: "2026-10-29T15:00:00Z", updatedAt: "2026-10-29T15:00:00Z", ...over });
const waiting = (id: string) => sale({ id, fiscalStatus: "needs_attention", blockReason: "customer_tax_id_missing", invoiceId: null, customer: { name: "Joao", email: null, taxId: null, taxIdMasked: true } });
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><IntegrationsPage /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(["integrations.view", "integrations.manage"]);
  mocks.list.mockResolvedValue([]);
  mocks.providers.mockResolvedValue([woovi, abacate]);
  mocks.companies.mockResolvedValue({ items: [company], hasMore: false, nextCursor: null });
  mocks.sales.mockResolvedValue([]);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(cleanup);

describe("Integrations page", () => {
  it("offers the platforms right in the empty state and jumps straight to the details", async () => {
    renderPage();
    await screen.findByText("No integrations yet");
    fireEvent.click(screen.getByRole("button", { name: /Woovi/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/AppID/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Company that issues the invoice/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("lists connections with the company, status, environment and how many sales need the client", async () => {
    mocks.list.mockResolvedValue([connection()]);
    mocks.sales.mockResolvedValue([sale(), waiting("s2"), waiting("s3")]);
    renderPage();
    await screen.findByText("Woovi");
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("2 sales need you")).toBeTruthy();
  });

  it("hides disconnected connections", async () => {
    mocks.list.mockResolvedValue([connection({ state: "disconnected" })]);
    renderPage();
    await screen.findByText("No integrations yet");
  });

  it("members without manage permission see no connect button and cannot start the wizard", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    renderPage();
    await screen.findByText("No integrations yet");
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Woovi/ })).toBeNull();
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

describe("Connect wizard", () => {
  async function openWoovi() {
    renderPage();
    await screen.findByText("No integrations yet");
    fireEvent.click(screen.getByRole("button", { name: /Woovi/ }));
    return screen.findByRole("dialog");
  }
  const fill = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.change(within(dialog).getByLabelText(/AppID/), { target: { value: "app-123" } });
  };

  it("connects in one click and shows the webhook address to register", async () => {
    mocks.create.mockResolvedValue(connection({ state: "draft" }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    const dialog = await openWoovi();
    fill(dialog);
    fireEvent.change(within(dialog).getByLabelText(/Service description/), { target: { value: "Consultoria" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: "woovi", companyId: "co1", environment: "test", credentials: { appId: "app-123" } }));
    expect(mocks.putRules).toHaveBeenCalledWith("c1", [{ service: { description: "Consultoria" }, sendEmail: true }]);
    expect(screen.getByText("https://api.corvo.tech/v1/integrations/inbound/PUB")).toBeTruthy();
    expect(screen.getByText("Create a webhook on Woovi.")).toBeTruthy();
    expect(screen.queryByText(/contains a secret/)).toBeNull();
    expect(mocks.list.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps Connect disabled until the company and the credentials are filled", async () => {
    const dialog = await openWoovi();
    const button = within(dialog).getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fill(dialog);
    expect(button.disabled).toBe(false);
  });

  it("explains which step failed, cleans up and never shows the address", async () => {
    mocks.create.mockResolvedValue(connection({ state: "draft" }));
    mocks.validate.mockRejectedValue(new Error("Woovi recusou o AppID informado"));
    mocks.disconnect.mockResolvedValue(connection({ state: "disconnected" }));
    const dialog = await openWoovi();
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await within(dialog).findByText(/Could not validate the credentials: Woovi recusou o AppID informado/);
    expect(mocks.disconnect).toHaveBeenCalledWith("c1");
    expect(screen.queryByText("Connected!")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("AbacatePay asks for the API key, generates the webhook secret and warns that the secret in the address is shown only once", async () => {
    mocks.create.mockResolvedValue(connection({ provider: "abacatepay", state: "draft", webhookUrl: "https://api.corvo.tech/v1/integrations/inbound/PUB?webhookSecret=S3", secrets: { webhookSecret: "S3" } }));
    mocks.validate.mockResolvedValue(connection());
    mocks.putRules.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(connection());
    renderPage();
    await screen.findByText("No integrations yet");
    fireEvent.click(screen.getByRole("button", { name: /AbacatePay/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Webhook secret/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Company that issues the invoice/), { target: { value: "co1" } });
    fireEvent.change(within(dialog).getByLabelText(/AbacatePay API key/), { target: { value: "abc_key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected!");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ credentials: { apiKey: "abc_key" } }));
    expect(screen.getByText(/webhookSecret=S3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the secret" })).toBeTruthy();
    expect(screen.getByText(/Also paste it into the webhook/)).toBeTruthy();
    expect(screen.getByText(/contains a secret/)).toBeTruthy();
  });

  it("from the toolbar, starts by choosing the platform and can go back", async () => {
    mocks.list.mockResolvedValue([connection()]);
    renderPage();
    await screen.findByText("Woovi");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /AbacatePay/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByRole("button", { name: /Woovi/ })).toBeTruthy();
  });
});

describe("Connection details", () => {
  async function openDetails(sales: unknown[] = [], over: Record<string, unknown> = {}) {
    mocks.list.mockResolvedValue([connection(over)]);
    mocks.sales.mockResolvedValue(sales);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Woovi/ }));
    return screen.findByRole("dialog");
  }

  it("shows the webhook address and the latest sales with their status", async () => {
    const dialog = await openDetails([sale(), waiting("s2")]);
    expect(within(dialog).getByText("https://api.corvo.tech/v1/integrations/inbound/PUB")).toBeTruthy();
    expect(await within(dialog).findByText("Invoice issued")).toBeTruthy();
    expect(within(dialog).getByText("CPF/CNPJ missing")).toBeTruthy();
  });

  it("says so when no sale arrived yet", async () => {
    const dialog = await openDetails([]);
    expect(await within(dialog).findByText(/No sales received yet/)).toBeTruthy();
  });

  it("pauses an active connection and resumes a paused one", async () => {
    mocks.pause.mockResolvedValue(connection({ state: "paused" }));
    mocks.activate.mockResolvedValue(connection({ state: "active" }));
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("c1"));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Resume" }));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("c1"));
  });

  it("asks for confirmation before disconnecting for good", async () => {
    mocks.disconnect.mockResolvedValue(connection({ state: "disconnected" }));
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(mocks.disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith("c1"));
  });

  it("completes the customer document of a waiting sale and issues it", async () => {
    mocks.completeCustomer.mockResolvedValue(sale());
    mocks.retry.mockResolvedValue({ state: "processed" });
    const dialog = await openDetails([waiting("s2")]);
    fireEvent.click(await within(dialog).findByRole("button", { name: "Add CPF/CNPJ" }));
    const input = within(dialog).getByLabelText(/Customer CPF or CNPJ/);
    const save = within(dialog).getByRole("button", { name: "Save and issue" }) as HTMLButtonElement;
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
    const dialog = await openDetails([sale({ fiscalStatus: "blocked", blockReason: "connection_inactive", invoiceId: null })]);
    fireEvent.click(await within(dialog).findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("s1"));
  });

  it("members without manage permission can read but not change anything", async () => {
    mocks.permissions = new Set(["integrations.view"]);
    const dialog = await openDetails([waiting("s2")]);
    await within(dialog).findByText("CPF/CNPJ missing");
    for (const name of ["Pause", "Disconnect", "Add CPF/CNPJ"]) expect(within(dialog).queryByRole("button", { name })).toBeNull();
  });

  it("tells the client to reconnect when the platform refused the credentials", async () => {
    const dialog = await openDetails([], { state: "reauth_required" });
    expect(within(dialog).getByText(/refused the credentials/)).toBeTruthy();
  });
});
