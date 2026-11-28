import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import {
  OUTBOX_REPOSITORY,
  type IOutboxRepository,
} from '../domain/outbox.repository';

/** An invoice still `queued` after this long lost its way between intake and the emission queue. */
const STALLED_AFTER_MS = 30 * 60_000;
/** Most invoices revived per run, so a big backlog never turns into a burst to the portal. */
const MAX_PER_RUN = 100;

/**
 * Every 10 minutes, puts back in line the invoices stuck in `queued`: their outbox message is dead
 * (the relay gave up) or finished while the queue job was lost. The outbox handlers are idempotent
 * (the job id is the invoice id), so reviving one that is only waiting its turn changes nothing.
 * Scheduled invoices keep a pending message, so this never emits them early.
 */
@Injectable()
export class StalledQueuedRecoveryScheduler {
  private readonly logger = new Logger(StalledQueuedRecoveryScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: IOutboxRepository,
  ) {}

  @Cron('*/10 * * * *')
  async handle(): Promise<void> {
    await observeScheduledTask('invoice.stalled-queued-recovery', () =>
      this.run(),
    );
  }

  async run(): Promise<number> {
    let revived = 0;
    const createdBefore = new Date(Date.now() - STALLED_AFTER_MS);
    await this.discovery.visit('stalled-queued', async (tenantId) => {
      const room = MAX_PER_RUN - revived;
      if (room <= 0) return;
      revived += await this.outbox.reviveStalledInvoices(
        tenantId,
        createdBefore,
        room,
      );
    });
    if (revived > 0)
      this.logger.warn({ revived }, 'Revived invoices stuck in queued');
    return revived;
  }
}
