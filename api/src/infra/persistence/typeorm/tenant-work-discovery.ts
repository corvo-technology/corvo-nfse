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
import { TenantBillingOrmEntity } from './entities/tenant-billing.orm-entity';

export type TenantWork =
  | 'invoice-recovery'
  | 'certificate-expiry'
  | 'webhook-delivery'
  | 'plan-expiry'
  | 'billing-reconciliation'
  | 'accountant-package';

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
