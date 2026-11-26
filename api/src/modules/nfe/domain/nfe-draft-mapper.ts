import type { NfeContent, NfeDocumentSnapshot } from './nfe-document';
import type { NfeDraft, NfeDraftItem, NfeIssuer } from './nfe-draft';
import { centsToString, toCents, type NfeTotals } from './totals';

/** What a validated draft stores: the document body, with money as 2-place strings. */
export function contentFromDraft(draft: NfeDraft): NfeContent {
  return {
    natOp: draft.natOp,
    idDest: draft.idDest,
    indFinal: draft.indFinal,
    indPres: draft.indPres,
    finNfe: draft.finNfe,
    tpImp: draft.tpImp,
    recipient: draft.recipient,
    items: draft.items.map((item) => ({
      nItem: item.nItem,
      code: item.code,
      gtin: item.gtin,
      description: item.description,
      ncm: item.ncm,
      cest: item.cest,
      cfop: item.cfop,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: centsToString(item.amounts.vProd),
      discount: centsToString(item.amounts.vDesc),
      freight: centsToString(item.amounts.vFrete),
      insurance: centsToString(item.amounts.vSeg),
      other: centsToString(item.amounts.vOutro),
      tax: item.tax,
      ibsCbs: null,
    })),
    totals: {
      vProd: centsToString(draft.totals.vProd),
      vDesc: centsToString(draft.totals.vDesc),
      vFrete: centsToString(draft.totals.vFrete),
      vSeg: centsToString(draft.totals.vSeg),
      vOutro: centsToString(draft.totals.vOutro),
      vNF: centsToString(draft.totals.vNF),
    },
    payment: {
      payments: draft.payments.map((p) => ({
        tPag: p.tPag,
        amount: centsToString(p.cents),
      })),
      change: centsToString(draft.changeCents),
    },
    additionalInfo: draft.additionalInfo,
    externalId: draft.externalId,
  };
}

/**
 * The draft the builder needs, read back from the stored document. Nothing is recalculated: the
 * amounts are the cents that were validated and stored, so every attempt builds the same note.
 */
export function draftFromDocument(
  doc: NfeDocumentSnapshot,
  issuer: NfeIssuer,
): NfeDraft {
  const items: NfeDraftItem[] = doc.items.map((item) => ({
    nItem: item.nItem,
    code: item.code,
    gtin: item.gtin,
    description: item.description,
    ncm: item.ncm,
    cest: item.cest,
    cfop: item.cfop,
    unit: item.unit,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    tax: item.tax,
    amounts: {
      vProd: toCents(item.total),
      vDesc: toCents(item.discount),
      vFrete: toCents(item.freight),
      vSeg: toCents(item.insurance),
      vOutro: toCents(item.other),
    },
  }));
  const totals: NfeTotals = {
    vProd: toCents(doc.totals.vProd),
    vDesc: toCents(doc.totals.vDesc),
    vFrete: toCents(doc.totals.vFrete),
    vSeg: toCents(doc.totals.vSeg),
    vOutro: toCents(doc.totals.vOutro),
    vNF: toCents(doc.totals.vNF),
    items: items.map((item) => item.amounts),
  };
  return {
    environment: doc.environment,
    issuer,
    natOp: doc.natOp,
    finNfe: doc.finNfe,
    tpImp: doc.tpImp,
    indPres: doc.indPres,
    indFinal: doc.indFinal,
    idDest: doc.idDest as 1 | 2,
    recipient: doc.recipient,
    items,
    totals,
    payments: doc.payment.payments.map((p) => ({
      tPag: p.tPag,
      cents: toCents(p.amount),
    })),
    changeCents: toCents(doc.payment.change),
    additionalInfo: doc.additionalInfo,
    externalId: doc.externalId,
  };
}
