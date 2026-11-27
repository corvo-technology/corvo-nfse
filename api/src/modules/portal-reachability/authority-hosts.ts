import type { EndpointRow } from '@/infra/external/nfe/sefaz/endpoints';
import {
  SVC_AUTHORITY_BY_UF,
  SVC_URL_AUTHORITY,
  UF_TABLE,
} from '@/infra/external/nfe/sefaz/uf';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import {
  nfceBreakerAuthority,
  nfeBreakerAuthority,
} from '@/modules/invoice/application/fiscal-portal-breaker';

export interface EnabledAuthority {
  uf: Uf;
  model: 55 | 65;
  tpAmb: 1 | 2;
}

export interface AuthorityHost {
  /** Same naming as the circuit breaker: `nfe-sp-2`, `nfce-sp-2`, `nfe-svcan-2`. */
  authority: string;
  host: string;
}

/**
 * The host of the "service status" endpoint of every authority that is enabled (plus the SVC
 * targets of the enabled NF-e UFs). Only enabled authorities are probed, so a UF nobody uses costs
 * nothing. A combination with no status row is left out.
 */
export function authorityHosts(
  rows: EndpointRow[],
  enabled: EnabledAuthority[],
): AuthorityHost[] {
  const found = new Map<string, string>();
  const statusHost = (
    authority: EndpointRow['authority'],
    model: 55 | 65,
    tpAmb: 1 | 2,
  ): string | undefined => {
    const row = rows.find(
      (r) =>
        r.authority === authority &&
        r.model === model &&
        r.tpAmb === tpAmb &&
        r.tpEmis === 1 &&
        r.service === 'NfeStatusServico',
    );
    return row ? new URL(row.url).hostname : undefined;
  };
  for (const { uf, model, tpAmb } of enabled) {
    const info = UF_TABLE[uf];
    if (!info) continue;
    const authority = model === 65 ? info.authorizer65 : info.authorizer55;
    const host = statusHost(authority, model, tpAmb);
    if (host) {
      const name =
        model === 65
          ? nfceBreakerAuthority(authority, tpAmb)
          : nfeBreakerAuthority(authority, tpAmb);
      found.set(name, host);
    }
    if (model !== 55) continue;
    const svc = SVC_AUTHORITY_BY_UF[uf];
    const svcHost = statusHost(SVC_URL_AUTHORITY[svc], 55, tpAmb);
    if (svcHost)
      found.set(`nfe-${svc.toLowerCase().replace('-', '')}-${tpAmb}`, svcHost);
  }
  return [...found].map(([authority, host]) => ({ authority, host }));
}
