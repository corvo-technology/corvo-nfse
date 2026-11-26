import type { NfeDraft } from '../nfe-draft';

/** Responsible technician of the software (`infRespTec`); comes from the NFE_RESP_TEC_* settings. */
export interface NfeRespTec {
  cnpj: string;
  contact: string;
  email: string;
  phone: string;
}

/** Everything a group needs; each group is a pure function of it. */
export interface BuildContext {
  draft: NfeDraft;
  /** IBGE code of the issuer's UF. */
  cUF: string;
  series: number;
  number: number;
  cNF: string;
  /** dhEmi with the offset of the issuer's UF. */
  dhEmi: string;
  tpAmb: 1 | 2;
  accessKey: string;
  verProc: string;
  respTec: NfeRespTec | null;
}

/** A tree for fast-xml-builder: keys keep their order, `@_` prefixes an attribute. */
export type XmlNode = { [key: string]: XmlValue };
export type XmlValue = string | number | XmlNode | XmlNode[] | undefined;

export const HOMOLOGATION_RECIPIENT_NAME =
  'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export const NFE_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';
