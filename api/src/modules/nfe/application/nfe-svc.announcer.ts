import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { EmailService } from '@/modules/email/application/email.service';
import { NfeAccessPolicy } from '@/modules/fiscal-core/application/nfe-access.policy';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { opsAlertEmails } from '@/modules/portal-reachability/portal-reachability.monitor';
import {
  svcEnteredEmail,
  svcExitedEmail,
  type SvcEmailInput,
} from './nfe-svc.email';

export interface SvcTransition {
  uf: Uf;
  tpAmb: 1 | 2;
  /** `SVCAN` or `SVCRS`. */
  authority: 'SVCAN' | 'SVCRS';
  dhCont: string | null;
  /** Who left the SVC by hand (the platform admin), when it was not automatic. */
  by?: string;
}

/**
 * Tells about a change of the SVC of one UF (decision 17 of the plan): a webhook to every workspace
 * with NF-e released and at least one company in that UF in that environment, and an e-mail to the
 * platform operator. Both are best-effort: the fiscal state is already committed.
 */
@Injectable()
export class NfeSvcAnnouncer {
  private readonly logger = new Logger(NfeSvcAnnouncer.name);

  constructor(
    private readonly database: DataSource,
    private readonly policy: NfeAccessPolicy,
    private readonly webhooks: FiscalWebhookPublisher,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async entered(change: SvcTransition): Promise<void> {
    await this.publish('nfe.contingency.entered', change);
    await this.mail(
      svcEnteredEmail(this.emailInput(change)),
      'entered',
      change,
    );
  }

  async exited(change: SvcTransition): Promise<void> {
    await this.publish('nfe.contingency.exited', change);
    await this.mail(svcExitedEmail(this.emailInput(change)), 'exited', change);
  }

  private emailInput(change: SvcTransition): SvcEmailInput {
    return {
      uf: change.uf,
      tpAmb: change.tpAmb,
      authority: change.authority,
      by: change.by,
    };
  }

  /** Workspaces with NF-e released and a company in the UF, in the environment of `tpAmb`. */
  async audience(uf: Uf, tpAmb: 1 | 2): Promise<string[]> {
    const rows = await runAsSystem('worker-discovery', () =>
      this.database
        .getRepository(CompanyOrmEntity)
        .createQueryBuilder('company')
        .innerJoin(TenantOrmEntity, 'tenant', 'tenant.id = company.tenant_id')
        .select('company.tenant_id', 'tenantId')
        .distinct(true)
        .where(
          'company.address_state = :uf AND company.environment = :environment AND company.deleted_at IS NULL AND tenant.nfe_enabled_at IS NOT NULL',
          { uf, environment: tpAmb === 1 ? 'live' : 'test' },
        )
        .getRawMany<{ tenantId: string }>(),
    );
    return rows.map((row) => row.tenantId);
  }

  private async publish(
    type: 'nfe.contingency.entered' | 'nfe.contingency.exited',
    change: SvcTransition,
  ): Promise<void> {
    try {
      const environment = change.tpAmb === 1 ? 'live' : 'test';
      for (const tenantId of await this.audience(change.uf, change.tpAmb)) {
        if (!(await this.policy.isEnabled(tenantId))) continue;
        await runWithTenant(tenantId, () =>
          this.webhooks.publishTenantEvent(tenantId, environment, type, {
            uf: change.uf,
            tpAmb: change.tpAmb,
            authority: change.authority,
            dhCont: change.dhCont,
          }),
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        { err: error, uf: change.uf, type },
        'Could not publish the SVC webhooks',
      );
    }
  }

  private async mail(
    rendered: ReturnType<typeof svcEnteredEmail>,
    event: 'entered' | 'exited',
    change: SvcTransition,
  ): Promise<void> {
    const recipients = opsAlertEmails(
      this.config.get<string>('OPS_ALERT_EMAILS'),
    );
    if (recipients.length === 0) {
      this.logger.warn(
        { event: 'svc_alert_no_recipients', uf: change.uf },
        'OPS_ALERT_EMAILS is empty: the SVC alert was not e-mailed',
      );
      return;
    }
    for (const to of recipients) {
      try {
        await this.email.enqueueNotice(to, rendered);
      } catch (error: unknown) {
        this.logger.error(
          { err: error, uf: change.uf, event },
          'Could not queue the SVC alert e-mail',
        );
      }
    }
  }
}
