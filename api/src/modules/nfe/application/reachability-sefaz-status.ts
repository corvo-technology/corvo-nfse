import { Injectable } from '@nestjs/common';
import { UF_TABLE } from '@/infra/external/nfe/sefaz/uf';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { nfeBreakerAuthority } from '@/modules/invoice/application/fiscal-portal-breaker';
import { AuthorityReachabilityStore } from '@/modules/portal-reachability/authority-reachability.store';
import type { SefazStatusPort } from './nfe-svc-switch.service';

/**
 * "Is this SEFAZ up" from what the connection monitor already measures every minute (the TCP + TLS
 * probe of the authority's `NfeStatusServico` host). The SOAP `consStatServ` would need a company's
 * A1 certificate, which the platform scheduler does not hold; the probe says the host answers, and
 * the circuit breaker (read apart by the switch) says whether real calls succeed. An unknown probe
 * counts as "not up": the SVC is never chosen, or left, on a guess.
 */
@Injectable()
export class ReachabilitySefazStatus implements SefazStatusPort {
  constructor(private readonly probes: AuthorityReachabilityStore) {}

  async isUp(uf: Uf, tpAmb: 1 | 2, tpEmis: 1 | 6 | 7): Promise<boolean> {
    const info = UF_TABLE[uf];
    const authority =
      tpEmis === 1 ? info.authorizer55 : tpEmis === 6 ? 'SVCAN' : 'SVCRS';
    try {
      const found = await this.probes.get(
        nfeBreakerAuthority(authority, tpAmb),
      );
      return found?.reachable === true;
    } catch {
      return false;
    }
  }
}
