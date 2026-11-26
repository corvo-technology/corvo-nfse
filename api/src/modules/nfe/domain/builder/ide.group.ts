import type { BuildContext, XmlNode } from './context';

/** `ide`: identification. `cDV` is the last digit of the key; `tpEmis` and `procEmi` are fixed. */
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
    tpEmis: 1,
    cDV: ctx.accessKey.slice(-1),
    tpAmb: ctx.tpAmb,
    finNFe: draft.finNfe,
    indFinal: draft.indFinal,
    indPres: draft.indPres,
    procEmi: 0,
    verProc: ctx.verProc,
  };
}
