import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { NfeNumberGapsQuery } from '../infra/typeorm-nfe-number-gaps.query';

const ENVIRONMENTS: ExecutionEnvironment[] = ['test', 'live'];

/**
 * Daily look at the numbering gaps of every tenant. It only writes a structured
 * log line per company and series with gaps; nothing is inutilized automatically and nobody is
 * e-mailed in this phase (the customer asks for the list or inutilizes from the panel).
 */
@Injectable()
export class NfeNumberGapsScheduler {
  private readonly logger = new Logger(NfeNumberGapsScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly gaps: NfeNumberGapsQuery,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleDaily(): Promise<void> {
    await observeScheduledTask('nfe.number-gaps', () => this.run());
  }

  async run(): Promise<void> {
    await this.discovery.visit('nfe-number-gaps', async (tenantId) => {
      for (const environment of ENVIRONMENTS) {
        const found = await this.gaps.list(tenantId, environment);
        const bySeries = new Map<
          string,
          { companyId: string; series: number; gaps: number }
        >();
        for (const gap of found) {
          const key = `${gap.companyId}:${gap.series}`;
          const entry = bySeries.get(key) ?? {
            companyId: gap.companyId,
            series: gap.series,
            gaps: 0,
          };
          entry.gaps += 1;
          bySeries.set(key, entry);
        }
        for (const entry of bySeries.values())
          this.logger.log({ tenantId, environment, ...entry });
      }
    });
  }
}
