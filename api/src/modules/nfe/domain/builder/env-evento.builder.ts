import { NFE_NAMESPACE } from './context';

export const CANCEL_EVENT = '110111';
export const CORRECTION_EVENT = '110110';
export const MAX_CORRECTIONS = 20;

/** An event or inutilization request, unsigned: the signer adds `<Signature>` to its parent element. */
export interface BuiltEvent {
  id: string;
  xml: string;
  referenceTag: 'infEvento' | 'infInut';
}

/**
 * `xCondUso` of the correction letter: fixed text of the MOC (and the only value `e110110_v1.00.xsd`
 * accepts), copied literally.
 */
export const CORRECTION_USE_CONDITIONS =
  'A Carta de Correção é disciplinada pelo § 1º-A do art. 7º do Convênio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularização de erro ocorrido na emissão de documento fiscal, desde que o erro não esteja relacionado com: I - as variáveis que determinam o valor do imposto tais como: base de cálculo, alíquota, diferença de preço, quantidade, valor da operação ou da prestação; II - a correção de dados cadastrais que implique mudança do remetente ou do destinatário; III - a data de emissão ou de saída.';

export interface EventBase {
  accessKey: string;
  cnpj: string;
  /** IBGE code of the UF that receives the event (the one in the access key). */
  cOrgao: string;
  tpAmb: 1 | 2;
  /** `dhEvento` with the offset of the issuer's UF. */
  dhEvento: string;
}

export interface CancelEventInput extends EventBase {
  nSeq: 1;
  protocol: string;
  justification: string;
}

export interface CorrectionEventInput extends EventBase {
  nSeq: number;
  correction: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Text of a customer goes through here: `&`, `<`, quotes. */
export function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function eventXml(
  input: EventBase & { nSeq: number },
  tpEvento: string,
  detail: string,
): BuiltEvent {
  const id = `ID${tpEvento}${input.accessKey}${String(input.nSeq).padStart(2, '0')}`;
  const xml =
    `<envEvento xmlns="${NFE_NAMESPACE}" versao="1.00"><idLote>1</idLote>` +
    `<evento versao="1.00"><infEvento Id="${id}">` +
    `<cOrgao>${input.cOrgao}</cOrgao><tpAmb>${input.tpAmb}</tpAmb>` +
    `<CNPJ>${input.cnpj}</CNPJ><chNFe>${input.accessKey}</chNFe>` +
    `<dhEvento>${input.dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${input.nSeq}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">${detail}</detEvento>` +
    '</infEvento></evento></envEvento>';
  return { id, xml, referenceTag: 'infEvento' };
}

/** Cancellation (110111): always `nSeqEvento` 1, with the protocol of the authorization. */
export function buildCancelEvent(input: CancelEventInput): BuiltEvent {
  return eventXml(
    input,
    CANCEL_EVENT,
    `<descEvento>Cancelamento</descEvento><nProt>${input.protocol}</nProt>` +
      `<xJust>${escapeXmlText(input.justification)}</xJust>`,
  );
}

/** Correction letter (110110): `nSeqEvento` grows with each letter of the same NF-e. */
export function buildCorrectionEvent(input: CorrectionEventInput): BuiltEvent {
  return eventXml(
    input,
    CORRECTION_EVENT,
    '<descEvento>Carta de Correção</descEvento>' +
      `<xCorrecao>${escapeXmlText(input.correction)}</xCorrecao>` +
      `<xCondUso>${CORRECTION_USE_CONDITIONS}</xCondUso>`,
  );
}
