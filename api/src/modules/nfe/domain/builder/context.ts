import type { TpEmis } from '@/modules/fiscal-core/domain/ports/authority.port';
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
  /** 1 normal, 6/7 SVC, 9 NFC-e off-line. */
  tpEmis: TpEmis;
  /** Present only with `tpEmis` 6, 7 or 9: `dhCont` and `xJust`. */
  contingency: NfeContingency | null;
}

/** The contingency of the emission: when it began (`dhCont`, with the UF offset) and why (`xJust`). */
export interface NfeContingency {
  tpEmis: 6 | 7 | 9;
  dhCont: string;
  /** 15 to 256 characters. */
  xJust: string;
}

/** A tree for fast-xml-builder: keys keep their order, `@_` prefixes an attribute. */
export type XmlNode = { [key: string]: XmlValue };
export type XmlValue = string | number | XmlNode | XmlNode[] | undefined;

export const HOMOLOGATION_RECIPIENT_NAME =
  'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

/**
 * Text of the first item of a NFC-e in homologation (`tpAmb` 2), instead of its description
 * (rejection 373) [verificar na homologação]. Only the XML changes; the stored item does not.
 */
export const NFCE_HOMOLOGATION_ITEM_DESCRIPTION =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export const NFE_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';
