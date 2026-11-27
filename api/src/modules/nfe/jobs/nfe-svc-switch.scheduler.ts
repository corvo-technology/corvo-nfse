import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isUf } from '@/infra/external/nfe/sefaz/uf';
import {
  NFE_ENABLED_AUTHORITIES,
  type NfeEnabledAuthorities,
} from '@/modules/fiscal-core/domain/nfe-enabled-authorities';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { NfeSvcSwitchService } from '../application/nfe-svc-switch.service';
import { TypeormNfeContingencyStates } from '../infra/typeorm-nfe-contingency-states';

/**
 * Every minute, asks the switch about each UF released for the NF-e (model 55) in each environment,
 * plus the UFs that are in the SVC right now (so one that lost its release can still leave it).
 */
@Injectable()
export class NfeSvcSwitchScheduler {
  private readonly logger = new Logger(NfeSvcSwitchScheduler.name);

  constructor(
    private readonly service: NfeSvcSwitchService,
    private readonly states: TypeormNfeContingencyStates,
    @Inject(NFE_ENABLED_AUTHORITIES)
    private readonly authorities: NfeEnabledAuthorities,
  ) {}

  @Cron('* * * * *')
  async handleMinute(): Promise<void> {
    await observeScheduledTask('nfe.svc-switch', () => this.run());
  }

  async run(now: Date = new Date()): Promise<void> {
    const targets = new Map<string, { uf: Uf; tpAmb: 1 | 2 }>();
    for (const row of await this.authorities.listEnabled()) {
      const uf = row.uf.toUpperCase();
      if (row.model === 55 && isUf(uf))
        targets.set(`${uf}-${row.tpAmb}`, { uf, tpAmb: row.tpAmb });
    }
    for (const row of await this.states.listActive())
      targets.set(`${row.uf}-${row.tpAmb}`, { uf: row.uf, tpAmb: row.tpAmb });

    for (const { uf, tpAmb } of targets.values()) {
      try {
        await this.service.evaluate(uf, tpAmb, now);
      } catch (error: unknown) {
        // One UF failing never stops the others.
        this.logger.error({ err: error, uf, tpAmb }, 'SVC evaluation failed');
      }
    }
  }
}
