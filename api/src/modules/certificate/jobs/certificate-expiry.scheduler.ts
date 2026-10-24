import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { ICertificateRepository } from '../domain/certificate.repository';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';

/**
 * Daily cron that marks expired certificates and recomputes
 * company setup status in batch (2 queries total, no N+1).
 */
@Injectable()
export class CertificateExpiryScheduler {
  private readonly logger = new Logger(CertificateExpiryScheduler.name);

  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly certRepo: ICertificateRepository,
    private readonly companyRepo: ICompanyRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpiry(): Promise<void> {
    await observeScheduledTask('certificate.expiry', () => this.expire());
  }

  private async expire(): Promise<void> {
    await this.discovery.visit('certificate-expiry', async (tenantId) => {
      // 1) Batch: mark all expired active certificates as 'expired'
      const expiredCompanyIds =
        await this.certRepo.expireExpiredCertificates(tenantId);

      if (expiredCompanyIds.length === 0) return;

      // 2) Batch: recompute setup status for affected companies
      await this.companyRepo.batchRecomputeStatus(expiredCompanyIds, tenantId);

      this.logger.log(
        `Marked ${expiredCompanyIds.length} company(ies) as pending_setup after certificate expiry`,
      );
    });
  }
}
