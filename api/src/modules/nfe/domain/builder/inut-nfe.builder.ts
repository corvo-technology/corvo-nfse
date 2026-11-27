import { NFE_NAMESPACE } from './context';
import { escapeXmlText, type BuiltEvent } from './env-evento.builder';

export interface InutilizationInput {
  /** IBGE code of the issuer's UF. */
  cUF: string;
  tpAmb: 1 | 2;
  /** Two digits. */
  ano: string;
  cnpj: string;
  model: 55 | 65;
  series: number;
  start: number;
  end: number;
  justification: string;
}

/**
 * `<inutNFe>` (service `NFeInutilizacao4`). `Id` is `"ID"` + cUF + ano + CNPJ + mod + serie(3) +
 * nNFIni(9) + nNFFin(9): 41 characters after the prefix.
 */
export function buildInutilization(input: InutilizationInput): BuiltEvent {
  const id =
    `ID${input.cUF}${input.ano}${input.cnpj}${input.model}` +
    `${String(input.series).padStart(3, '0')}` +
    `${String(input.start).padStart(9, '0')}${String(input.end).padStart(9, '0')}`;
  const xml =
    `<inutNFe xmlns="${NFE_NAMESPACE}" versao="4.00"><infInut Id="${id}">` +
    `<tpAmb>${input.tpAmb}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${input.cUF}</cUF>` +
    `<ano>${input.ano}</ano><CNPJ>${input.cnpj}</CNPJ><mod>${input.model}</mod>` +
    `<serie>${input.series}</serie><nNFIni>${input.start}</nNFIni><nNFFin>${input.end}</nNFFin>` +
    `<xJust>${escapeXmlText(input.justification)}</xJust></infInut></inutNFe>`;
  return { id, xml, referenceTag: 'infInut' };
}
