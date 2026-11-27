import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { supportedAuthorities } from '@/infra/external/nfe/sefaz/supported-authorities';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { NfeSvcSwitchService } from '../application/nfe-svc-switch.service';
import { TypeormNfeContingencyStates } from '../infra/typeorm-nfe-contingency-states';

/**
 * Every minute, asks the switch about each UF the code supports for the NF-e (model 55) in
 * homologação (and in production when `NFE_PRODUCTION_ENABLED` is on), plus the UFs that are in the
 * SVC right now (so one that is no longer in the list can still leave it).
 */
@Injectable()
export class NfeSvcSwitchScheduler {
  private readonly logger = new Logger(NfeSvcSwitchScheduler.name);

  constructor(
    private readonly service: NfeSvcSwitchService,
    private readonly states: TypeormNfeContingencyStates,
    private readonly config: ConfigService,
  ) {}

  @Cron('* * * * *')
  async handleMinute(): Promise<void> {
    await observeScheduledTask('nfe.svc-switch', () => this.run());
  }

  async run(now: Date = new Date()): Promise<void> {
    const targets = new Map<string, { uf: Uf; tpAmb: 1 | 2 }>();
    const production =
      this.config.get<boolean>('NFE_PRODUCTION_ENABLED') === true;
    for (const row of supportedAuthorities({ production }))
      if (row.model === 55)
        targets.set(`${row.uf}-${row.tpAmb}`, {
          uf: row.uf,
          tpAmb: row.tpAmb,
        });
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
