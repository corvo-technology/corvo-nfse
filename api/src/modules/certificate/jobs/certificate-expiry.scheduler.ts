import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { ICertificateRepository } from '../domain/certificate.repository';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
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
    private readonly eventBus: ApplicationEventBus,
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

      await this.warnExpiring(tenantId);
      if (expiredCompanyIds.length === 0) return;
      await this.announceExpired(tenantId, expiredCompanyIds);

      // 2) Batch: recompute setup status for affected companies
      await this.companyRepo.batchRecomputeStatus(expiredCompanyIds, tenantId);

      this.logger.log(
        `Marked ${expiredCompanyIds.length} company(ies) as pending_setup after certificate expiry`,
      );
    });
  }

  /** 30 and 7 days before: the listener sends each stage of a company once. */
  private async warnExpiring(tenantId: string): Promise<void> {
    const soon = await this.certRepo.findExpiringSoon(tenantId, 30);
    const week = Date.now() + 7 * 86_400_000;
    for (const cert of soon)
      this.eventBus.publishBestEffort(
        accountNotice(tenantId, {
          kind: 'certificate-expiring',
          companyId: cert.companyId,
          companyName: cert.companyName,
          stage: cert.validUntil.getTime() <= week ? 7 : 30,
          validUntil: cert.validUntil,
        }),
      );
  }

  private async announceExpired(
    tenantId: string,
    companyIds: string[],
  ): Promise<void> {
    for (const companyId of companyIds) {
      // Live only: findByIdAndTenantId returns nothing for a test company.
      const company = await this.companyRepo.findByIdAndTenantId(
        companyId,
        tenantId,
        'live',
      );
      if (!company) continue;
      this.eventBus.publishBestEffort(
        accountNotice(tenantId, {
          kind: 'certificate-expiring',
          companyId,
          companyName: company.tradeName ?? company.legalName,
          stage: 0,
          validUntil: new Date(),
        }),
      );
    }
  }
}
