import { maskCurrency, maskTaxId } from "./masks";
import type { Invoice } from "./types";

export const copyInvoiceHref = (invoiceId: string) => `/app/invoices/new?from=${encodeURIComponent(invoiceId)}`;

/** Form values of an existing invoice, ready to issue again. The reference is left empty so the copy is a new invoice, and the competence is today. */
export function invoiceToFormValues(invoice: Invoice, today: string) {
  const customer = invoice.customerSnapshot;
  const foreign = customer?.foreign;
  return {
    companyId: invoice.companyId,
    externalId: "",
    customerTaxId: customer?.taxId ? maskTaxId(customer.taxId) : "",
    customerName: customer?.name ?? "",
    customerEmail: customer?.email ?? "",
    city: customer?.address?.city ?? "",
    state: customer?.address?.state ?? "",
    serviceDescription: invoice.serviceSnapshot.description ?? "",
    serviceCode: invoice.serviceSnapshot.code ?? "",
    municipalityCode: invoice.serviceSnapshot.municipalityCode ?? "",
    competenceDate: today,
    amount: maskCurrency(String(Math.round(invoice.amount * 100))),
    deduction: invoice.deduction ? maskCurrency(String(Math.round(invoice.deduction * 100))) : "",
    purchaseOrder: invoice.serviceSnapshot.purchaseOrder ?? "",
    notes: invoice.serviceSnapshot.notes ?? "",
    // A customer abroad is copied as such, and the Brazilian fields stay empty.
    ...(foreign ? { abroad: "yes", foreignTaxId: foreign.taxId ?? "", noTaxIdReason: foreign.noTaxIdReason ?? "", country: foreign.country, postalCode: foreign.postalCode, foreignCity: foreign.city, region: foreign.region, street: foreign.street, number: foreign.number, district: foreign.district, complement: foreign.complement ?? "" } : { abroad: "", foreignTaxId: "", noTaxIdReason: "", country: "", postalCode: "", foreignCity: "", region: "", street: "", number: "", district: "", complement: "" }),
    sendEmail: Boolean(customer?.email),
  };
}
