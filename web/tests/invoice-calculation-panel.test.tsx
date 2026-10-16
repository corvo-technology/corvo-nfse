// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { InvoiceCalculationPanel } from "@/components/dashboard/invoice-calculation-panel";
import type { InvoiceCalculation } from "@/lib/types";
import messages from "@/messages/en.json";

const base: InvoiceCalculation = {
  preEmission: true, status: "ready", disclaimer: "x", competenceDate: "2026-10-13", taxRegime: "MEI",
  taxes: {}, withholdings: [], netReceivableAmount: "50.00", collectionWaived: false,
  warnings: [], pendingFields: [], blocking: null,
};
const format = (value: string) => `R$ ${value}`;
const renderPanel = (result: InvoiceCalculation) => render(<NextIntlClientProvider locale="en" messages={messages}><InvoiceCalculationPanel result={result} format={format} /></NextIntlClientProvider>);
afterEach(cleanup);

describe("InvoiceCalculationPanel", () => {
  it("shows a ready MEI calculation with no taxes and the net amount", () => {
    renderPanel(base);
    expect(screen.getByText("Ready to issue")).toBeTruthy();
    expect(screen.getByText("No taxes shown in this scenario.")).toBeTruthy();
    expect(screen.getByText("R$ 50.00")).toBeTruthy();
  });
  it("lists taxes and withholdings", () => {
    renderPanel({ ...base, taxes: { iss: { base: "1000.00", rate: "3.00", amount: "30.00" } }, withholdings: [{ tax: "IRRF", base: "1000.00", rate: "1.50", amount: "15.00" }], netReceivableAmount: "955.00" });
    expect(screen.getByText("ISS · 3%")).toBeTruthy();
    expect(screen.getByText("IRRF · 1.5%")).toBeTruthy();
    expect(screen.getByText("R$ 955.00")).toBeTruthy();
  });
  it("explains a blocked calculation with the code and the pending fields", () => {
    renderPanel({ ...base, status: "blocked", netReceivableAmount: null, blocking: { code: "FISCAL_CLASSIFICATION_REQUIRED", message: "Classification is required", step: "tax-applicability", category: "CLASSIFICATION", retryable: false }, pendingFields: [{ field: "service.fiscal.cst", reason: "missing" }] });
    expect(screen.getByText("Cannot calculate yet")).toBeTruthy();
    expect(screen.getByText("FISCAL_CLASSIFICATION_REQUIRED")).toBeTruthy();
    expect(screen.getByText("service.fiscal.cst")).toBeTruthy();
    expect(screen.queryByText("Net amount receivable")).toBeNull();
  });
});
