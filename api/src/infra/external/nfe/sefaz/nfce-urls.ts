import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { AuthorityNotConfiguredError } from './endpoints';

/** The two URLs a NFC-e carries in `infNFeSupl` (and prints in the DANFCE). */
export interface NfceUrls {
  /** Base of the QR Code; the query (`?p=...`) is appended by the QR builder. */
  qrCode: string;
  /** `urlChave`: consultation by access key, 21 to 85 characters (XSD). */
  urlChave: string;
}

/**
 * Per UF and `tpAmb`. A UF enters only with an official source, next to its row in `ENDPOINTS_65`.
 *
 * SP:
 * - `qrCode` (both environments) and the production `urlChave`: ENCAT, "URL por UF utilizada QR
 *   code" (http://nfce.encat.org/desenvolvedor/qrcode/, read on 2026-11-26) [verificado].
 * - Homologation `urlChave`: ENCAT lists
 *   `https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx`,
 *   which has 94 characters and breaks the XSD limit of 85 for `urlChave`. The short `/consulta`
 *   address below is the alternative [não verificado: confirm in the SP homologation roteiro].
 */
export const NFCE_URLS: Partial<Record<Uf, Record<1 | 2, NfceUrls>>> = {
  SP: {
    2: {
      qrCode: 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode',
      urlChave: 'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta',
    },
    1: {
      qrCode: 'https://www.nfce.fazenda.sp.gov.br/qrcode',
      urlChave:
        'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
    },
  },
};

/** Throws `AuthorityNotConfiguredError` for a UF without a line (it cannot emit a NFC-e). */
export function nfceUrlsFor(uf: Uf, tpAmb: 1 | 2): NfceUrls {
  const found = NFCE_URLS[uf]?.[tpAmb];
  if (!found) throw new AuthorityNotConfiguredError(uf, 'NfceUrls', tpAmb);
  return found;
}
