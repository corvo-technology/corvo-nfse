import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { ImportRepository } from '../domain/import.repository';
import { ImportEmitService } from '../application/import-emit.service';

/** An import emitting for longer than this gets a look, even if nobody opens it. */
const EMITTING_AFTER_MS = 10 * 60_000;
const MAX_PER_TENANT = 50;

/**
 * Every 10 minutes, looks at imports still `emitting`: puts back in the queue the rows whose job was
 * lost and closes the import once every invoice is final. Until now an import only closed when
 * someone read it, so one nobody opened stayed `emitting` forever.
 */
@Injectable()
export class ImportEmitRecoveryCron {
  private readonly logger = new Logger(ImportEmitRecoveryCron.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly repo: ImportRepository,
    private readonly emitter: ImportEmitService,
  ) {}

  @Cron('*/10 * * * *')
  async handle(): Promise<void> {
    await observeScheduledTask('import.emit-recovery', () => this.run());
  }

  async run(): Promise<number> {
    let checked = 0;
    const startedBefore = new Date(Date.now() - EMITTING_AFTER_MS);
    await this.discovery.visit('import-emitting', async (tenantId) => {
      const stuck = await this.repo.listEmittingStartedBefore(
        tenantId,
        startedBefore,
        MAX_PER_TENANT,
      );
      for (const record of stuck) {
        try {
          await this.emitter.recover({
            tenantId,
            environment: record.environment,
            importId: record.id,
          });
          checked += 1;
        } catch (error) {
          this.logger.warn({
            event: 'import_emit_recovery_failed',
            importId: record.id,
            error: String(error),
          });
        }
      }
    });
    return checked;
  }
}
