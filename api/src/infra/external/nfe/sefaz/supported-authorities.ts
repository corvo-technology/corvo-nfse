import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { NFCE_URLS } from './nfce-urls';
import { UF_TABLE } from './uf';

export interface SupportedAuthority {
  uf: Uf;
  model: 55 | 65;
  tpAmb: 1 | 2;
}

/** Can the code emit a NFC-e (model 65) for this UF in this environment? (It needs its QR Code addresses.) */
export function nfceSupported(uf: string, tpAmb: 1 | 2): boolean {
  return NFCE_URLS[uf.toUpperCase() as Uf]?.[tpAmb] !== undefined;
}

/**
 * Every UF x model x environment the code can talk to: the NF-e (55) of every UF and the NFC-e (65)
 * of the UFs that have their NFC-e addresses. Homologação always; production only when the
 * production switch (`NFE_PRODUCTION_ENABLED`) is on. The connection monitor and the SVC switch
 * look at this list: there is no table to fill in and nothing to release.
 */
export function supportedAuthorities(options: {
  production: boolean;
}): SupportedAuthority[] {
  const tpAmbs: (1 | 2)[] = options.production ? [2, 1] : [2];
  const found: SupportedAuthority[] = [];
  for (const tpAmb of tpAmbs)
    for (const uf of Object.keys(UF_TABLE) as Uf[]) {
      found.push({ uf, model: 55, tpAmb });
      if (nfceSupported(uf, tpAmb)) found.push({ uf, model: 65, tpAmb });
    }
  return found;
}
