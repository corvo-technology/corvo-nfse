import type { NfeDocument } from '../domain/nfe-document';
import { nfeRepeatNotNormal } from './nfe-errors';

const money = (value: string): number => Number(value);
const orUndefined = <T>(value: T | null | undefined): T | undefined =>
  value === null || value === undefined || value === '' ? undefined : value;

function items(doc: NfeDocument) {
  return doc.toSnapshot().items.map((item) => ({
    code: item.code,
    gtin: orUndefined(item.gtin),
    description: item.description,
    ncm: item.ncm,
    cest: orUndefined(item.cest),
    cfop: item.cfop,
    unit: item.unit,
    quantity: money(item.quantity),
    unitPrice: money(item.unitPrice),
    ...(money(item.discount) > 0 ? { discount: money(item.discount) } : {}),
    ...(money(item.freight) > 0 ? { freight: money(item.freight) } : {}),
    ...(money(item.insurance) > 0 ? { insurance: money(item.insurance) } : {}),
    ...(money(item.other) > 0 ? { other: money(item.other) } : {}),
    tax: {
      origin: item.tax.origin,
      csosn: item.tax.csosn,
      pisCst: item.tax.pisCst,
      cofinsCst: item.tax.cofinsCst,
    },
  }));
}

function payments(doc: NfeDocument) {
  const { payments: paid, change } = doc.toSnapshot().payment;
  return {
    payments: paid.map((payment) => ({
      tPag: payment.tPag,
      amount: money(payment.amount),
      ...(payment.card
        ? {
            card: {
              tpIntegra: payment.card.tpIntegra,
              cnpj: orUndefined(payment.card.cnpj),
              tBand: orUndefined(payment.card.tBand),
              cAut: orUndefined(payment.card.cAut),
            },
          }
        : {}),
    })),
    ...(money(change) > 0 ? { change: money(change) } : {}),
  };
}

/**
 * The request that issues a new note with the content of this one: the parties, items, payments,
 * nature of operation and additional information. Never the key, number, protocol, date, external id
 * or anything of the authorization: the new note gets its own. Only a normal note (finNfe 1) is copied.
 * The body is validated like any other (the route sends it through its DTO).
 */
export function repeatRequest(
  doc: NfeDocument,
  additionalInfo?: string,
): Record<string, unknown> {
  const s = doc.toSnapshot();
  if (s.finNfe !== 1) throw nfeRepeatNotNormal();
  const common = {
    companyId: s.companyId,
    items: items(doc),
    ...payments(doc),
    additionalInfo: additionalInfo ?? orUndefined(s.additionalInfo),
    sendEmail: s.sendEmail,
  };
  const r = s.recipient;
  if (s.model === 55)
    return {
      ...common,
      natOp: s.natOp,
      tpImp: s.tpImp,
      recipient: r && {
        taxId: r.taxId,
        name: r.name,
        indIeDest: r.indIeDest,
        stateRegistration: orUndefined(r.stateRegistration),
        email: orUndefined(r.email),
        address: r.address && { ...r.address },
      },
    };
  const delivery = r?.address && r.address.street !== '';
  return {
    ...common,
    indPres: s.indPres,
    recipient: r && {
      taxId: orUndefined(r.taxId),
      name: orUndefined(r.name),
      email: orUndefined(r.email),
      ...(delivery ? { address: { ...r.address } } : {}),
    },
  };
}
