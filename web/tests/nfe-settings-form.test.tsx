// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NfeSettingsForm } from "@/components/companies/nfe-settings-form";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/nfe", async (original) => ({
  ...(await original<typeof import("@/lib/nfe")>()),
  getNfeSettings: mocks.get,
  updateNfeSettings: mocks.update,
}));

const settings = (overrides = {}) => ({
  companyId: "c1", stateRegistration: null, crt: null, defaultSeries: 1, defaultNatOp: "Venda de mercadoria", defaultCsosn: "102", defaultOrigin: 0, defaultPisCst: "49", defaultCofinsCst: "49",
  enabledAt: null, missing: ["state_registration", "crt"], ...overrides,
});
const renderForm = (canManage = true, nfce = false) => render(<NextIntlClientProvider locale="en" messages={messages}><NfeSettingsForm companyId="c1" canManage={canManage} nfce={nfce} /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(settings()); });
afterEach(cleanup);

describe("NfeSettingsForm", () => {
  it("lists what is still missing to issue NF-e, in plain words", async () => {
    renderForm();
    await screen.findByText("This is still missing to issue NF-e:");
    expect(screen.getByText("State registration (IE)", { selector: "li" })).toBeTruthy();
    expect(screen.getByText("The company's tax regime (Simples Nacional or MEI)", { selector: "li" })).toBeTruthy();
  });

  it("says the company is ready when nothing is missing", async () => {
    mocks.get.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [] }));
    renderForm();
    await screen.findByText("All set: the company can issue NF-e.");
    expect((screen.getByLabelText(/State registration \(IE\)/) as HTMLInputElement).value).toBe("110042490114");
  });

  it("does not ask for the regime: it shows the one of the company, read only, with a link to change it", async () => {
    mocks.get.mockResolvedValue(settings({ crt: 1, taxRegime: "Simples Nacional", missing: ["state_registration"] }));
    renderForm();
    await screen.findByText("This is still missing to issue NF-e:");
    const regime = screen.getByTestId("nfe-regime");
    expect(regime.textContent).toContain("Simples Nacional");
    expect(regime.querySelector("select, input")).toBeNull();
    expect(regime.querySelector("a")?.getAttribute("href")).toBe("/app/companies/c1#fiscal");
    expect(screen.queryByText(/only for Simples Nacional and MEI/)).toBeNull();
  });

  it("shows MEI, and says NF-e is not available for another regime", async () => {
    mocks.get.mockResolvedValue(settings({ crt: 4, taxRegime: "MEI", missing: [] }));
    const first = renderForm();
    await screen.findByText("All set: the company can issue NF-e.");
    expect(screen.getByTestId("nfe-regime").textContent).toContain("MEI");
    first.unmount();
    mocks.get.mockResolvedValue(settings({ crt: null, taxRegime: "Lucro Presumido", missing: ["crt"] }));
    renderForm();
    await screen.findByText(/NF-e is only for Simples Nacional and MEI for now/);
  });

  it("saves the IE without sending any regime, and shows an example as the placeholder", async () => {
    mocks.update.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [] }));
    renderForm();
    await screen.findByText("This is still missing to issue NF-e:");
    fireEvent.change(screen.getByLabelText(/State registration \(IE\)/), { target: { value: "110042490114" } });
    expect((screen.getByLabelText(/State registration \(IE\)/) as HTMLInputElement).placeholder).toMatch(/^e\.g\. /);
    fireEvent.click(screen.getByRole("button", { name: "Save NF-e data" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("c1", expect.objectContaining({ stateRegistration: "110042490114", defaultSeries: 1, defaultCsosn: "102" })));
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("crt");
    await screen.findByText("NF-e data saved.");
  });

  it("shows the IE error under the IE field when the API says STATE_REGISTRATION_INVALID", async () => {
    mocks.update.mockRejectedValue(new ApiError(422, "invalid", "STATE_REGISTRATION_INVALID"));
    renderForm();
    await screen.findByText("This is still missing to issue NF-e:");
    fireEvent.change(screen.getByLabelText(/State registration \(IE\)/), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Save NF-e data" }));
    const field = await screen.findByText(messages.ApiErrors.state_registration_invalid);
    expect(field.id).toMatch(/-err$/);
    expect(screen.getByLabelText(/State registration \(IE\)/).getAttribute("aria-invalid")).toBe("true");
  });

  it("only lets an admin change the data", async () => {
    renderForm(false);
    await screen.findByText("Only account admins can change this data.");
    expect(screen.queryByRole("button", { name: "Save NF-e data" })).toBeNull();
    expect((screen.getByLabelText(/State registration \(IE\)/) as HTMLInputElement).disabled).toBe(true);
  });

  it("NFC-e released: shows the NFC-e series and saves it; without it the field is not there", async () => {
    mocks.get.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [], nfceDefaultSeries: 2 }));
    mocks.update.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [], nfceDefaultSeries: 3 }));
    const first = renderForm(true, true);
    await screen.findByText("All set: the company can issue NF-e.");
    const field = screen.getByLabelText(/NFC-e series/) as HTMLInputElement;
    expect(field.value).toBe("2");
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save NF-e data" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("c1", expect.objectContaining({ defaultSeries: 1, nfceDefaultSeries: 3 })));
    first.unmount();
    renderForm(true, false);
    await screen.findByText("All set: the company can issue NF-e.");
    expect(screen.queryByLabelText(/NFC-e series/)).toBeNull();
  });

  it("NFC-e released: the off-line option is off by default, can be turned on and is saved", async () => {
    mocks.get.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [] }));
    mocks.update.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [], nfceAutoOffline: true }));
    renderForm(true, true);
    await screen.findByText("All set: the company can issue NF-e.");
    const box = screen.getByLabelText(/Issue in offline contingency automatically/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Save NF-e data" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("c1", expect.objectContaining({ nfceAutoOffline: true })));
    await waitFor(() => expect((screen.getByLabelText(/Issue in offline contingency automatically/) as HTMLInputElement).checked).toBe(true));
  });

  it("without NFC-e the off-line option is not offered nor sent", async () => {
    mocks.get.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [] }));
    mocks.update.mockResolvedValue(settings({ stateRegistration: "110042490114", crt: 1, missing: [] }));
    renderForm(true, false);
    await screen.findByText("All set: the company can issue NF-e.");
    expect(screen.queryByLabelText(/Issue in offline contingency automatically/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save NF-e data" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("nfceAutoOffline");
  });
});
