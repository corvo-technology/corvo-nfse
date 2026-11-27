import { Module } from '@nestjs/common';
import { FISCAL_SITUATION_READER } from '@/modules/fiscal-core/domain/fiscal-situation';
import { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import { AuthorityReachabilityStore } from './authority-reachability.store';
import { GovRouteSelector } from './gov-route.selector';
import { FiscalSituationReaderImpl } from './fiscal-situation.reader';
import { PortalReachabilityStore } from './reachability.store';

/**
 * Read side of the connection monitor: what the probes saw (NFS-e state and each SEFAZ), in Redis,
 * and the single reader that joins them with the circuit breaker, plus the selector that decides
 * whether government calls take the backup proxy. Importable by the API and the worker, which never
 * run the probes themselves.
 */
@Module({
  providers: [
    PortalReachabilityStore,
    AuthorityReachabilityStore,
    FiscalPortalBreaker,
    GovRouteSelector,
    { provide: FISCAL_SITUATION_READER, useClass: FiscalSituationReaderImpl },
  ],
  exports: [
    PortalReachabilityStore,
    GovRouteSelector,
    AuthorityReachabilityStore,
    FiscalPortalBreaker,
    FISCAL_SITUATION_READER,
  ],
})
export class PortalReachabilityReadModule {}
