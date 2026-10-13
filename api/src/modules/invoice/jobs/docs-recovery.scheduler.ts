import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';

const QUEUE_NAME = 'nfse-doc-prep';
const JOB_NAME = 'prepare';

@Injectable()
export class DocsRecoveryScheduler {
  private readonly logger = new Logger(DocsRecoveryScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    private readonly queueService: BullmqQueueService,
    @InjectDataSource() private readonly database: DataSource,
  ) {}

  @Cron('*/5 * * * *')
  async handle(): Promise<void> {
    await this.discovery.visit('invoice-recovery', async (tenantId) => {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000);
      const fiscal = await this.database
        .getRepository(InvoiceOrmEntity)
        .createQueryBuilder('i')
        .where('i.status IN (:...statuses)', {
          statuses: ['queued', 'processing', 'reconciliation_required'],
        })
        .andWhere('i.updated_at < :cutoff AND i.tenant_id = :tenantId', {
          cutoff,
          tenantId,
        })
        .take(50)
        .getMany();
      for (const i of fiscal)
        await this.queueService.add(
          i.status === 'queued' ? 'nfse-emission' : 'nfse-reconciliation',
          'recover',
          { invoiceId: i.id, tenantId: i.tenantId, companyId: i.companyId },
          {
            attempts: 5,
            backoffMs: 30000,
            removeOnComplete: true,
            removeOnFail: 1000,
          },
        );
      const pending = await this.invoiceRepo.findAuthorizedWithoutDocuments(
        tenantId,
        cutoff,
        50,
      );

      for (const { id, tenantId, companyId } of pending) {
        try {
          await this.queueService.add(
            QUEUE_NAME,
            JOB_NAME,
            { invoiceId: id, tenantId, companyId },
            {
              attempts: 5,
              backoffMs: 10_000,
              removeOnComplete: false,
              removeOnFail: 1000,
            },
          );
          this.logger.log(`Re-enqueued doc-prep for invoice ${id}`);
        } catch (err) {
          this.logger.error(
            `Failed to re-enqueue doc-prep for invoice ${id}:`,
            err,
          );
        }
      }

      if (pending.length > 0) {
        this.logger.log(
          `Recovered ${pending.length} pending document preparations`,
        );
      }
    });
  }
}
