import { Module } from '@nestjs/common';
import { FISCAL_SITUATION_READER } from '@/modules/fiscal-core/domain/fiscal-situation';
import { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import { AuthorityReachabilityStore } from './authority-reachability.store';
import { FiscalSituationReaderImpl } from './fiscal-situation.reader';
import { PortalReachabilityStore } from './reachability.store';

/**
 * Read side of the connection monitor: what the probes saw (NFS-e state and each SEFAZ), in Redis,
 * and the single reader that joins them with the circuit breaker. Importable by the API and the
 * worker, which never run the probes themselves.
 */
@Module({
  providers: [
    PortalReachabilityStore,
    AuthorityReachabilityStore,
    FiscalPortalBreaker,
    { provide: FISCAL_SITUATION_READER, useClass: FiscalSituationReaderImpl },
  ],
  exports: [
    PortalReachabilityStore,
    AuthorityReachabilityStore,
    FiscalPortalBreaker,
    FISCAL_SITUATION_READER,
  ],
})
export class PortalReachabilityReadModule {}
