import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { Injectable } from '@nestjs/common';
import {
  DataSource,
  type SelectQueryBuilder,
  type ObjectLiteral,
} from 'typeorm';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import { CertificateOrmEntity } from '@/modules/certificate/infra/certificate.orm-entity';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { WebhookDeliveryOrmEntity } from '@/modules/webhooks-config/infra/webhook-delivery.orm-entity';
import { AccountAuditEventOrmEntity } from '@/modules/account-audit/infra/account-audit-event.orm-entity';
import { NfeNumberSequenceOrmEntity } from '@/modules/nfe/infra/nfe-number-sequence.orm-entity';
import { PaymentIntentOrmEntity } from '@/modules/billing/infra/payment-intent.orm-entity';
import { previousMonth } from '@/modules/invoice/application/package/package-month';
import { brtMonthWindow } from '@/modules/lifecycle-emails/brt-time';
import { TenantBillingOrmEntity } from './entities/tenant-billing.orm-entity';

export type TenantWork =
  | 'invoice-recovery'
  | 'manual-review-sweep'
  | 'certificate-expiry'
  | 'portal-sync'
  | 'webhook-delivery'
  | 'plan-expiry'
  | 'billing-reconciliation'
  | 'accountant-package'
  | 'account-audit-retention'
  | 'nfe-number-gaps'
  | 'lifecycle-monthly-summary'
  | 'lifecycle-payment-pending';

/** Worker orchestration only: discover owner IDs, then enter a scoped operation. */
@Injectable()
export class TenantWorkDiscovery {
  constructor(private readonly database: DataSource) {}
  async visit(
    kind: TenantWork,
    work: (tenantId: string) => Promise<void>,
  ): Promise<void> {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const owners = await this.discover(kind, after);
      for (const tenantId of owners)
        await runWithTenant(tenantId, () => work(tenantId));
      if (owners.length < 100) return;
      after = owners[owners.length - 1];
    }
  }
  async discover(kind: TenantWork, after: string): Promise<string[]> {
    return runAsSystem('worker-discovery', async () => {
      const now = new Date();
      let query: SelectQueryBuilder<ObjectLiteral>;
      let owner = 'work.tenant_id';
      if (kind === 'invoice-recovery') {
        query = this.database
          .getRepository(InvoiceOrmEntity)
          .createQueryBuilder('work')
          .where(
            "work.status IN ('processing','reconciliation_required','authorized')",
          );
      } else if (kind === 'manual-review-sweep') {
        query = this.database
          .getRepository(InvoiceOrmEntity)
          .createQueryBuilder('work')
          .where("work.status = 'manual_review'");
      } else if (kind === 'certificate-expiry') {
        owner = 'company.tenant_id';
        query = this.database
          .getRepository(CertificateOrmEntity)
          .createQueryBuilder('work')
          .innerJoin(
            CompanyOrmEntity,
            'company',
            'company.id = work.company_id',
          )
          .where(
            "work.status = 'active' AND work.deleted_at IS NULL AND work.valid_until <= :now",
            { now },
          );
      } else if (kind === 'accountant-package') {
        query = this.database
          .getRepository(CompanyOrmEntity)
          .createQueryBuilder('work')
          .where(
            "work.accountant_email IS NOT NULL AND work.environment = 'live' AND work.deleted_at IS NULL",
          );
      } else if (kind === 'lifecycle-monthly-summary') {
        // Workspaces that issued a live invoice in the month that ended.
        const { start, end } = brtMonthWindow(previousMonth(now));
        query = this.database
          .getRepository(InvoiceOrmEntity)
          .createQueryBuilder('work')
          .where(
            "work.environment = 'live' AND work.status = 'authorized' AND work.authorized_at >= :start AND work.authorized_at < :end",
            { start, end },
          );
      } else if (kind === 'lifecycle-payment-pending') {
        // Checkouts started 1 to 3 days ago that are still unpaid.
        query = this.database
          .getRepository(PaymentIntentOrmEntity)
          .createQueryBuilder('work')
          .where(
            "work.status IN ('pending', 'expired') AND work.created_at <= :from AND work.created_at >= :until",
            {
              from: new Date(now.getTime() - 24 * 3_600_000),
              until: new Date(now.getTime() - 72 * 3_600_000),
            },
          );
      } else if (kind === 'account-audit-retention') {
        query = this.database
          .getRepository(AccountAuditEventOrmEntity)
          .createQueryBuilder('work')
          .where("work.occurred_at < now() - interval '365 days'");
      } else if (kind === 'nfe-number-gaps') {
        query = this.database
          .getRepository(NfeNumberSequenceOrmEntity)
          .createQueryBuilder('work')
          .where('work.current_number > 0');
      } else if (kind === 'portal-sync') {
        // Workspaces with a certificate that can still sign: the only ones the portal answers.
        owner = 'company.tenant_id';
        query = this.database
          .getRepository(CertificateOrmEntity)
          .createQueryBuilder('work')
          .innerJoin(
            CompanyOrmEntity,
            'company',
            'company.id = work.company_id',
          )
          .where(
            "work.status = 'active' AND work.deleted_at IS NULL AND work.valid_until > :now AND company.deleted_at IS NULL",
            { now },
          );
      } else if (kind === 'webhook-delivery') {
        query = this.database
          .getRepository(WebhookDeliveryOrmEntity)
          .createQueryBuilder('work')
          .where(
            "work.status IN ('pending','delayed','manual_retry') AND work.next_retry_at <= :now",
            { now },
          );
      } else {
        query = this.database
          .getRepository(TenantBillingOrmEntity)
          .createQueryBuilder('work');
        if (kind === 'plan-expiry')
          query.where('work.current_period_end < :now', { now });
        else query.where('work.stripe_customer_id IS NOT NULL');
      }
      const rows = await query
        .select(owner, 'tenantId')
        .distinct(true)
        .andWhere(`${owner} > :after`, { after })
        .orderBy(owner, 'ASC')
        .limit(100)
        .getRawMany<{ tenantId: string }>();
      return rows.map((row) => row.tenantId);
    });
  }
}
