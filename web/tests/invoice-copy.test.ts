import { describe, expect, it } from "vitest";
import { copyInvoiceHref, invoiceToFormValues } from "@/lib/invoice-copy";
import type { Invoice } from "@/lib/types";

const invoice = {
  id: "inv/1", companyId: "company", amount: 1234.5, competenceDate: "2026-01-10", externalId: "order-9",
  customerSnapshot: { taxId: "11222333000181", name: "Acme", email: "a@acme.com", address: { city: "São Paulo", state: "SP" } },
  serviceSnapshot: { description: "Consulting", code: "010601", municipalityCode: "3550308" },
} as unknown as Invoice;

describe("invoice copy", () => {
  it("builds the new-invoice link with an encoded source id", () => {
    expect(copyInvoiceHref("inv/1")).toBe("/app/invoices/new?from=inv%2F1");
  });
  it("copies customer, service and amount, but uses today as competence and drops the reference", () => {
    expect(invoiceToFormValues(invoice, "2026-10-18")).toEqual({
      companyId: "company", externalId: "", customerTaxId: "11.222.333/0001-81", customerName: "Acme", customerEmail: "a@acme.com",
      city: "São Paulo", state: "SP", serviceDescription: "Consulting", serviceCode: "010601", municipalityCode: "3550308",
      competenceDate: "2026-10-18", amount: "1.234,50", deduction: "", sendEmail: true,
    });
  });
  it("copies the declared deduction so an invoice with a deduction can be duplicated", () => {
    expect(invoiceToFormValues({ ...invoice, deduction: 500.25 } as Invoice, "2026-10-18")).toMatchObject({ amount: "1.234,50", deduction: "500,25" });
  });
  it("leaves the deduction empty when the source invoice has none or zero", () => {
    expect(invoiceToFormValues({ ...invoice, deduction: 0 } as Invoice, "2026-10-18").deduction).toBe("");
  });
  it("copies an invoice without tomador as an empty customer and no email", () => {
    const values = invoiceToFormValues({ ...invoice, customerSnapshot: null } as Invoice, "2026-10-18");
    expect(values).toMatchObject({ customerTaxId: "", customerName: "", customerEmail: "", city: "", state: "", sendEmail: false });
  });
});
