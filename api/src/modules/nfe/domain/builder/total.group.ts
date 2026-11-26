import { centsToString } from '../totals';
import type { BuildContext, XmlNode } from './context';

const ZERO = '0.00';

/** `total/ICMSTot`: only the goods totals; every tax total is zero in the Simples phase. */
export function totalGroup(ctx: BuildContext): XmlNode {
  const { totals } = ctx.draft;
  return {
    ICMSTot: {
      vBC: ZERO,
      vICMS: ZERO,
      vICMSDeson: ZERO,
      vFCP: ZERO,
      vBCST: ZERO,
      vST: ZERO,
      vFCPST: ZERO,
      vFCPSTRet: ZERO,
      vProd: centsToString(totals.vProd),
      vFrete: centsToString(totals.vFrete),
      vSeg: centsToString(totals.vSeg),
      vDesc: centsToString(totals.vDesc),
      vII: ZERO,
      vIPI: ZERO,
      vIPIDevol: ZERO,
      vPIS: ZERO,
      vCOFINS: ZERO,
      vOutro: centsToString(totals.vOutro),
      vNF: centsToString(totals.vNF),
    },
  };
}
