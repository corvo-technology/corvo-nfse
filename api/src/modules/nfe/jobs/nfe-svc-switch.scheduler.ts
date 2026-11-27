import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { NfeSvcSwitchService } from '../application/nfe-svc-switch.service';
import { TypeormNfeContingencyStates } from '../infra/typeorm-nfe-contingency-states';
import { TypeormNfeSvcAudience } from '../infra/typeorm-nfe-svc-audience';

/**
 * Every minute, asks the switch about each UF x environment that has at least one company with
 * NF-e settings (production only when `NFE_PRODUCTION_ENABLED` is on). A UF in the SVC that no
 * company uses is cleared quietly.
 */
@Injectable()
export class NfeSvcSwitchScheduler {
  private readonly logger = new Logger(NfeSvcSwitchScheduler.name);

  constructor(
    private readonly service: NfeSvcSwitchService,
    private readonly states: TypeormNfeContingencyStates,
    private readonly config: ConfigService,
    private readonly audience: TypeormNfeSvcAudience,
  ) {}

  @Cron('* * * * *')
  async handleMinute(): Promise<void> {
    await observeScheduledTask('nfe.svc-switch', () => this.run());
  }

  async run(now: Date = new Date()): Promise<void> {
    const production =
      this.config.get<boolean>('NFE_PRODUCTION_ENABLED') === true;
    // Only what a company uses: no company, no target (a failed read watches nothing).
    let monitored: { uf: Uf; tpAmb: 1 | 2 }[] = [];
    try {
      monitored = await this.audience.monitoredTargets(production);
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'Could not list the monitored UFs');
    }
    const targets = new Map(
      monitored.map((t) => [`${t.uf}-${t.tpAmb}`, t] as const),
    );

    for (const row of await this.states.listActive()) {
      if (targets.has(`${row.uf}-${row.tpAmb}`)) continue;
      // In the SVC but nobody uses it: leaves quietly (no e-mail, no webhook).
      try {
        await this.service.clearSilently(row.uf, row.tpAmb, now);
      } catch (error: unknown) {
        this.logger.error(
          { err: error, uf: row.uf, tpAmb: row.tpAmb },
          'SVC silent clear failed',
        );
      }
    }

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
