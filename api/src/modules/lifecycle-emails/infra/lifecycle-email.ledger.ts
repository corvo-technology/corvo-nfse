import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { LifecycleEmailSendOrmEntity } from './lifecycle-email-send.orm-entity';

export type LifecycleEmailKind =
  'first-invoice' | 'monthly-summary' | 'payment-pending';

/** What was already sent to each workspace: the unique key makes a second send impossible. */
@Injectable()
export class LifecycleEmailLedger {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private repo() {
    return this.db.repository(LifecycleEmailSendOrmEntity);
  }

  /** True only for the call that recorded it. False when this kind and period were already sent. */
  claim(
    tenantId: string,
    kind: LifecycleEmailKind,
    period: string,
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const result = await this.repo()
        .createQueryBuilder()
        .insert()
        .values({ tenantId, kind, period })
        .orIgnore()
        .returning('id')
        .execute();
      return Array.isArray(result.raw) && result.raw.length > 0;
    });
  }

  /** Takes the claim back when the e-mail could not be queued, so a later run can try again. */
  release(
    tenantId: string,
    kind: LifecycleEmailKind,
    period: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      await this.repo().delete({ tenantId, kind, period });
    });
  }

  /** How many lifecycle e-mails the workspace got since `since`. */
  countSince(tenantId: string, since: Date): Promise<number> {
    return runWithTenant(tenantId, () =>
      this.repo()
        .createQueryBuilder('sent')
        .where('sent.tenant_id = :tenantId AND sent.created_at >= :since', {
          tenantId,
          since,
        })
        .getCount(),
    );
  }
}
