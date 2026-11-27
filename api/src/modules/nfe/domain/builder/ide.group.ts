import type { BuildContext, XmlNode } from './context';

/** `ide`: identification. `cDV` is the last digit of the key; `procEmi` is fixed and `tpEmis` follows the contingency. */
export function ideGroup(ctx: BuildContext): XmlNode {
  const { draft } = ctx;
  return {
    cUF: ctx.cUF,
    cNF: ctx.cNF,
    natOp: draft.natOp,
    mod: draft.model,
    serie: ctx.series,
    nNF: ctx.number,
    dhEmi: ctx.dhEmi,
    tpNF: 1,
    idDest: draft.idDest,
    cMunFG: draft.issuer.address.cityCode,
    tpImp: draft.tpImp,
    tpEmis: ctx.tpEmis,
    cDV: ctx.accessKey.slice(-1),
    tpAmb: ctx.tpAmb,
    finNFe: draft.finNfe,
    indFinal: draft.indFinal,
    indPres: draft.indPres,
    procEmi: 0,
    verProc: ctx.verProc,
    ...(ctx.contingency
      ? { dhCont: ctx.contingency.dhCont, xJust: ctx.contingency.xJust }
      : {}),
  };
}
