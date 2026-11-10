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
      competenceDate: "2026-10-18", amount: "1.234,50", deduction: "", purchaseOrder: "", notes: "", abroad: "", foreignTaxId: "", noTaxIdReason: "", country: "", postalCode: "", foreignCity: "", region: "", street: "", number: "", district: "", complement: "", sendEmail: true,
    });
  });
  it("copies the declared deduction so an invoice with a deduction can be duplicated", () => {
    expect(invoiceToFormValues({ ...invoice, deduction: 500.25 } as Invoice, "2026-10-18")).toMatchObject({ amount: "1.234,50", deduction: "500,25" });
  });
  it("copies a customer abroad as such, with its address and without a Brazilian document", () => {
    const foreign = { taxId: "12-3456789", country: "US", postalCode: "94105", city: "San Francisco", region: "CA", street: "1 Market St", number: "100", district: "SoMa" };
    const values = invoiceToFormValues({ ...invoice, customerSnapshot: { name: "Acme Inc.", foreign } } as Invoice, "2026-10-18");
    expect(values).toMatchObject({ abroad: "yes", customerName: "Acme Inc.", customerTaxId: "", foreignTaxId: "12-3456789", noTaxIdReason: "", country: "US", postalCode: "94105", foreignCity: "San Francisco", region: "CA", street: "1 Market St", number: "100", district: "SoMa", complement: "" });
  });
  it("copies the purchase order and the notes printed on the source invoice", () => {
    const source = { ...invoice, serviceSnapshot: { ...invoice.serviceSnapshot, purchaseOrder: "PO-4521", notes: "Parcela 2 de 3" } } as Invoice;
    expect(invoiceToFormValues(source, "2026-10-18")).toMatchObject({ purchaseOrder: "PO-4521", notes: "Parcela 2 de 3" });
  });
  it("leaves the deduction empty when the source invoice has none or zero", () => {
    expect(invoiceToFormValues({ ...invoice, deduction: 0 } as Invoice, "2026-10-18").deduction).toBe("");
  });
  it("copies an invoice without tomador as an empty customer and no email", () => {
    const values = invoiceToFormValues({ ...invoice, customerSnapshot: null } as Invoice, "2026-10-18");
    expect(values).toMatchObject({ customerTaxId: "", customerName: "", customerEmail: "", city: "", state: "", sendEmail: false });
  });
});
