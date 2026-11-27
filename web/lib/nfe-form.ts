import { errorCodeKey, fieldIssues } from "./api-errors";
import { maskCurrency } from "./masks";
import type { NfeCreateInput, NfeDocument, NfeItemInput } from "./nfe";

/** What the person types: everything is text until it is sent. */
export interface NfeItemForm { code: string; description: string; ncm: string; cfop: string; unit: string; quantity: string; unitPrice: string; csosn: "" | "102" | "400"; /** True once the person typed the CFOP: it is then no longer suggested from the recipient's state. */ cfopManual?: boolean }
export interface NfePaymentForm { tPag: string; amount: string }
export interface NfeFormState {
  companyId: string;
  natOp: string;
  recipient: { taxId: string; name: string; indIeDest: "1" | "2" | "9"; stateRegistration: string; email: string; street: string; number: string; complement: string; district: string; zip: string; cityCode: string; city: string; state: string };
  items: NfeItemForm[];
  payments: NfePaymentForm[];
  change: string;
  additionalInfo: string;
  sendEmail: boolean;
}

/** Payment means the SEFAZ knows (tPag); the ones people use most come first. */
export const PAYMENT_MEANS = ["17", "01", "03", "04", "15", "99"] as const;

export const emptyItem = (): NfeItemForm => ({ code: "", description: "", ncm: "", cfop: "5102", unit: "UN", quantity: "1", unitPrice: "", csosn: "" });
export const emptyPayment = (): NfePaymentForm => ({ tPag: "17", amount: "" });
export const emptyForm = (companyId = ""): NfeFormState => ({
  companyId, natOp: "",
  recipient: { taxId: "", name: "", indIeDest: "9", stateRegistration: "", email: "", street: "", number: "", complement: "", district: "", zip: "", cityCode: "", city: "", state: "" },
  items: [emptyItem()], payments: [emptyPayment()], change: "", additionalInfo: "", sendEmail: true,
});

const text = (value: string) => value.trim();
const optional = (value: string) => (value.trim() === "" ? undefined : value.trim());
/** Accepts "10,5", "10.5" and the BRL mask "1.234,56". */
export const toNumber = (value: string) => {
  const text = value.trim();
  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
};

/** A number as the BRL input shows it: 12.5 becomes "12,50". */
export const toMoneyText = (value: number | string): string => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  // A price with more than 2 decimals (the NF-e allows 10) is kept as it is, not rounded.
  if (Math.abs(number * 100 - Math.round(number * 100)) > 1e-6) return String(number).replace(".", ",");
  return maskCurrency(String(Math.round(number * 100)));
};

/** The CFOP that fits the operation: 5102 inside the state of the issuer, 6102 for another state. Empty until both are known. */
export function suggestedCfop(issuerState: string | undefined, recipientState: string): string {
  const from = (issuerState ?? "").trim().toUpperCase();
  const to = recipientState.trim().toUpperCase();
  if (from.length !== 2 || to.length !== 2) return "";
  return from === to ? "5102" : "6102";
}

/** NCM as people read it: 6109.10.00 (the API gets only the 8 digits). */
export const maskNcm = (value: string): string => value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{4})(\d)/, "$1.$2").replace(/^(\d{4})\.(\d{2})(\d)/, "$1.$2.$3");

/** The quantity of an item times its price, in cents, so a line total never meets a float. */
export const lineTotal = (item: Pick<NfeItemForm, "quantity" | "unitPrice">): number => {
  const value = toNumber(item.quantity) * toNumber(item.unitPrice);
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
};

/** State registration (IE) example for a UF, to show as the placeholder. */
const IE_EXAMPLES: Record<string, string> = { SP: "110.042.490.114", RJ: "99.999.99-3", MG: "062.307.904/0081", RS: "096/3277812", PR: "123.45678-50", SC: "251.040.852", BA: "123456-63", GO: "10.987.654-7", PE: "0321418-40", CE: "06.000001-5", DF: "07.300001.001-09" };
export const ieExample = (uf: string): string => IE_EXAMPLES[uf.trim().toUpperCase()] ?? "110042490114";

export function toCreateInput(form: NfeFormState): NfeCreateInput {
  const r = form.recipient;
  const items: NfeItemInput[] = form.items.map((item, index) => ({
    // `cProd` is mandatory in the XML, but nobody should have to invent it: ITEM-1, ITEM-2...
    code: text(item.code) || `ITEM-${index + 1}`, description: text(item.description), ncm: text(item.ncm).replace(/\D/g, ""), cfop: text(item.cfop), unit: text(item.unit) || "UN",
    quantity: toNumber(item.quantity), unitPrice: toNumber(item.unitPrice),
    ...(item.csosn ? { tax: { csosn: item.csosn } } : {}),
  }));
  return {
    companyId: form.companyId,
    ...(optional(form.natOp) ? { natOp: text(form.natOp) } : {}),
    recipient: {
      taxId: text(r.taxId), name: text(r.name), indIeDest: Number(r.indIeDest) as 1 | 2 | 9,
      ...(r.indIeDest === "1" ? { stateRegistration: text(r.stateRegistration) } : {}),
      ...(optional(r.email) ? { email: text(r.email) } : {}),
      address: { street: text(r.street), number: text(r.number), ...(optional(r.complement) ? { complement: text(r.complement) } : {}), district: text(r.district), zip: text(r.zip), cityCode: text(r.cityCode), city: text(r.city), state: text(r.state).toUpperCase() },
    },
    items,
    payments: form.payments.map((payment) => ({ tPag: payment.tPag, amount: toNumber(payment.amount) })),
    // Change only exists for cash: a leftover value of another means is never sent.
    ...(optional(form.change) && form.payments.some((payment) => payment.tPag === "01") ? { change: toNumber(form.change) } : {}),
    ...(optional(form.additionalInfo) ? { additionalInfo: text(form.additionalInfo) } : {}),
    sendEmail: form.sendEmail,
  };
}

/** Fills the form with a rejected note, to fix it and send it again. */
export function fromDocument(doc: NfeDocument): NfeFormState {
  const r = doc.recipient;
  const paid = doc.payment.payments;
  const recipient = r
    ? { taxId: r.taxId, name: r.name, indIeDest: String(r.indIeDest) as "1" | "2" | "9", stateRegistration: r.stateRegistration ?? "", email: r.email ?? "", street: r.address.street, number: r.address.number, complement: r.address.complement ?? "", district: r.address.district, zip: r.address.zip, cityCode: r.address.cityCode, city: r.address.city, state: r.address.state }
    : emptyForm().recipient;
  return {
    companyId: doc.companyId, natOp: doc.natOp,
    recipient,
    items: doc.items.map((item) => ({ code: item.code, description: item.description, ncm: item.ncm, cfop: item.cfop, unit: item.unit, quantity: String(Number(item.quantity)), unitPrice: toMoneyText(item.unitPrice), cfopManual: true, csosn: item.tax?.csosn === "400" ? "400" : item.tax?.csosn === "102" ? "102" : "" })),
    payments: paid.map((payment) => ({ tPag: payment.tPag, amount: toMoneyText(payment.amount) })),
    change: Number(doc.payment.change) > 0 ? toMoneyText(doc.payment.change) : "",
    additionalInfo: doc.additionalInfo ?? "", sendEmail: true,
  };
}

/** For display only: the API calculates the real totals. Each item is rounded to cents (half up) like the invoice. */
export function totalsPreview(items: Pick<NfeItemForm, "quantity" | "unitPrice">[]): number {
  const cents = items.reduce((sum, item) => {
    const value = toNumber(item.quantity) * toNumber(item.unitPrice);
    return sum + (Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) : 0);
  }, 0);
  return cents / 100;
}

/** Payments minus change, in whole cents, so the check never meets a float. */
export function paidPreview(payments: NfePaymentForm[], change: string): number {
  const cents = payments.reduce((sum, payment) => { const value = toNumber(payment.amount); return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0); }, 0);
  const back = change.trim() === "" ? 0 : Math.round(toNumber(change) * 100);
  return (cents - (Number.isFinite(back) ? back : 0)) / 100;
}

/**
 * The field problems of a 400/422 as `{ "items[1].ncm": "text" }`. `translate` gets the code (as the
 * translation tables are keyed) and the API's own sentence as fallback.
 */
export function issueErrors(cause: unknown, translate: (code: string, fallback: string) => string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of fieldIssues(cause)) if (!result[issue.field]) result[issue.field] = translate(errorCodeKey(issue.code), issue.message);
  return result;
}
