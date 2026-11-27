import { cleanTaxId } from "./masks";
import { emptyForm, emptyItem, emptyPayment, toMoneyText, toNumber, type NfeItemForm, type NfePaymentForm } from "./nfe-form";
import type { NfceCreateInput, NfceCardInput, NfceIndPres, NfeDocument, NfeItemInput } from "./nfe";

/** Payments that may carry the card data (`card`): credit, debit and Pix. */
export const CARD_MEANS = ["03", "04", "17"] as const;
/** Card brands of the SEFAZ table (`tBand`). */
export const CARD_BRANDS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "99"] as const;

export interface NfcePaymentForm extends NfePaymentForm { cardBrand: string; cardAuth: string; cardCnpj: string }
export interface NfceFormState {
  companyId: string;
  /** Everything about the consumer is optional on a sale in person. */
  consumer: { taxId: string; name: string; email: string };
  /** The delivery address (`indPres` 4). It uses the same fields as the NF-e recipient. */
  address: { street: string; number: string; complement: string; district: string; zip: string; cityCode: string; city: string; state: string };
  indPres: "1" | "4" | "5";
  items: NfeItemForm[];
  payments: NfcePaymentForm[];
  change: string;
  additionalInfo: string;
  sendEmail: boolean;
}

const emptyNfcePayment = (): NfcePaymentForm => ({ ...emptyPayment(), cardBrand: "", cardAuth: "", cardCnpj: "" });
export const emptyNfceForm = (companyId = ""): NfceFormState => {
  const { recipient } = emptyForm(companyId);
  return {
    companyId, consumer: { taxId: "", name: "", email: "" },
    address: { street: recipient.street, number: recipient.number, complement: recipient.complement, district: recipient.district, zip: recipient.zip, cityCode: recipient.cityCode, city: recipient.city, state: recipient.state },
    indPres: "1", items: [emptyItem()], payments: [emptyNfcePayment()], change: "", additionalInfo: "", sendEmail: true,
  };
};

const text = (value: string) => value.trim();
const optional = (value: string) => (value.trim() === "" ? undefined : value.trim());

function cardOf(payment: NfcePaymentForm): NfceCardInput | undefined {
  if (!(CARD_MEANS as readonly string[]).includes(payment.tPag)) return undefined;
  const brand = optional(payment.cardBrand);
  const auth = optional(payment.cardAuth);
  const cnpj = cleanTaxId(payment.cardCnpj);
  if (!brand && !auth && !cnpj) return undefined;
  // Integrated payment (the card machine talks to the sales system) needs the CNPJ and the authorization.
  return { tpIntegra: cnpj && auth ? 1 : 2, ...(cnpj ? { cnpj } : {}), ...(brand ? { tBand: brand } : {}), ...(auth ? { cAut: auth } : {}) };
}

export function toNfceInput(form: NfceFormState): NfceCreateInput {
  const items: NfeItemInput[] = form.items.map((item, index) => ({
    code: text(item.code) || `ITEM-${index + 1}`, description: text(item.description), ncm: text(item.ncm).replace(/\D/g, ""), cfop: text(item.cfop), unit: text(item.unit) || "UN",
    quantity: toNumber(item.quantity), unitPrice: toNumber(item.unitPrice),
    ...(item.csosn ? { tax: { csosn: item.csosn } } : {}),
  }));
  const a = form.address;
  const delivery = form.indPres === "4";
  const taxId = cleanTaxId(form.consumer.taxId);
  const recipient = {
    ...(taxId ? { taxId } : {}),
    ...(optional(form.consumer.name) ? { name: text(form.consumer.name) } : {}),
    ...(optional(form.consumer.email) ? { email: text(form.consumer.email) } : {}),
    ...(delivery ? { address: { street: text(a.street), number: text(a.number), ...(optional(a.complement) ? { complement: text(a.complement) } : {}), district: text(a.district), zip: text(a.zip), cityCode: text(a.cityCode), city: text(a.city), state: text(a.state).toUpperCase() } } : {}),
  };
  return {
    companyId: form.companyId,
    ...(Object.keys(recipient).length > 0 ? { recipient } : {}),
    ...(form.indPres !== "1" ? { indPres: Number(form.indPres) as NfceIndPres } : {}),
    items,
    payments: form.payments.map((payment) => ({ tPag: payment.tPag, amount: toNumber(payment.amount), ...(cardOf(payment) ? { card: cardOf(payment) } : {}) })),
    ...(optional(form.change) && form.payments.some((payment) => payment.tPag === "01") ? { change: toNumber(form.change) } : {}),
    ...(optional(form.additionalInfo) ? { additionalInfo: text(form.additionalInfo) } : {}),
    sendEmail: optional(form.consumer.email) !== undefined && form.sendEmail,
  };
}

/** What a delivery sale needs before it is sent: the API asks for it too, but the person learns sooner. Keys are the field paths of the API. */
export function deliveryProblems(form: NfceFormState): Record<string, "required"> {
  if (form.indPres !== "4") return {};
  const problems: Record<string, "required"> = {};
  if (cleanTaxId(form.consumer.taxId) === "") problems["recipient.taxId"] = "required";
  if (form.consumer.name.trim() === "") problems["recipient.name"] = "required";
  const a = form.address;
  for (const field of ["street", "number", "district", "zip", "city", "state"] as const) if (a[field].trim() === "") problems[`recipient.address.${field}`] = "required";
  if (!/^\d{7}$/.test(a.cityCode)) problems["recipient.address.cityCode"] = "required";
  return problems;
}

/** Fills the form with a rejected NFC-e, to fix it and send it again. */
export function fromNfceDocument(doc: NfeDocument): NfceFormState {
  const base = emptyNfceForm(doc.companyId);
  const r = doc.recipient;
  const delivery = r?.address && r.address.street !== "";
  return {
    ...base,
    consumer: { taxId: r?.taxId ?? "", name: r?.name ?? "", email: r?.email ?? "" },
    address: delivery ? { street: r.address.street, number: r.address.number, complement: r.address.complement ?? "", district: r.address.district, zip: r.address.zip, cityCode: r.address.cityCode, city: r.address.city, state: r.address.state } : base.address,
    indPres: delivery ? "4" : "1",
    items: doc.items.map((item) => ({ code: item.code, description: item.description, ncm: item.ncm, cfop: item.cfop, unit: item.unit, quantity: String(Number(item.quantity)), unitPrice: toMoneyText(item.unitPrice), cfopManual: true, csosn: item.tax?.csosn === "400" ? "400" : item.tax?.csosn === "102" ? "102" : "" })),
    payments: doc.payment.payments.map((payment) => ({ ...emptyNfcePayment(), tPag: payment.tPag, amount: toMoneyText(payment.amount) })),
    change: Number(doc.payment.change) > 0 ? toMoneyText(doc.payment.change) : "",
    additionalInfo: doc.additionalInfo ?? "",
  };
}

export { emptyNfcePayment };
