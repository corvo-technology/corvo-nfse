import { Injectable } from '@nestjs/common';
import type {
  FiscalSituation,
  FiscalSituationQuery,
  FiscalSituationReader,
} from '@/modules/fiscal-core/domain/fiscal-situation';
import { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import { AuthorityReachabilityStore } from './authority-reachability.store';
import { PortalReachabilityStore } from './reachability.store';

/**
 * Joins the three signals about an authority: its circuit breaker, its last TCP probe and the
 * monitor's classification of the whole connection. Each one that cannot be read counts as "nothing
 * wrong", so a Redis failure never pushes a document into contingency.
 */
@Injectable()
export class FiscalSituationReaderImpl implements FiscalSituationReader {
  constructor(
    private readonly breaker: FiscalPortalBreaker,
    private readonly probes: AuthorityReachabilityStore,
    private readonly monitor: PortalReachabilityStore,
  ) {}

  async situation(q: FiscalSituationQuery): Promise<FiscalSituation> {
    const [breakerOpen, authorityReachable, network] = await Promise.all([
      this.breaker
        .status(q.environment, q.authority)
        .then((status) => !status.available)
        .catch(() => false),
      this.probes
        .get(q.authority)
        .then((found) => found?.reachable ?? null)
        .catch(() => null),
      this.monitor
        .current()
        .then((current) => current.state)
        .catch((): FiscalSituation['network'] => 'ok'),
    ]);
    return { breakerOpen, authorityReachable, network };
  }
}
