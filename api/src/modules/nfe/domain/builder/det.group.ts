import { centsToString } from '../totals';
import type { NfeDraftItem } from '../nfe-draft';
import type { BuildContext, XmlNode } from './context';

const NO_GTIN = 'SEM GTIN';

/** Price with 2 to 10 decimals (the layout's TDec_1110v): trailing zeros beyond 2 are dropped. */
export function unitPriceText(tenDecimals: string): string {
  const [whole, fraction = ''] = tenDecimals.split('.');
  return `${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

const positive = (cents: number): string | undefined =>
  cents > 0 ? centsToString(cents) : undefined;

function prod(item: NfeDraftItem): XmlNode {
  const price = unitPriceText(item.unitPrice);
  const gtin = item.gtin ?? NO_GTIN;
  return {
    cProd: item.code,
    cEAN: gtin,
    xProd: item.description,
    NCM: item.ncm,
    CEST: item.cest ?? undefined,
    // The layout asks for the relevant-scale indicator whenever a CEST is sent.
    indEscala: item.cest ? 'S' : undefined,
    CFOP: item.cfop,
    uCom: item.unit,
    qCom: item.quantity,
    vUnCom: price,
    vProd: centsToString(item.amounts.vProd),
    cEANTrib: gtin,
    uTrib: item.unit,
    qTrib: item.quantity,
    vUnTrib: price,
    vFrete: positive(item.amounts.vFrete),
    vSeg: positive(item.amounts.vSeg),
    vDesc: positive(item.amounts.vDesc),
    vOutro: positive(item.amounts.vOutro),
    indTot: 1,
  };
}

/** Simples Nacional without credit (ICMSSN102) and zeroed PIS/COFINS "outras operações". */
function imposto(item: NfeDraftItem): XmlNode {
  return {
    ICMS: { ICMSSN102: { orig: item.tax.origin, CSOSN: item.tax.csosn } },
    PIS: {
      PISOutr: {
        CST: item.tax.pisCst,
        vBC: '0.00',
        pPIS: '0.0000',
        vPIS: '0.00',
      },
    },
    COFINS: {
      COFINSOutr: {
        CST: item.tax.cofinsCst,
        vBC: '0.00',
        pCOFINS: '0.0000',
        vCOFINS: '0.00',
      },
    },
  };
}

/** `det[]`: one per item, numbered from 1. */
export function detGroup(ctx: BuildContext): XmlNode[] {
  return ctx.draft.items.map((item) => ({
    '@_nItem': String(item.nItem),
    prod: prod(item),
    imposto: imposto(item),
  }));
}
