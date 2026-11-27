import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { EmailService } from '@/modules/email/application/email.service';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { opsAlertEmails } from '@/modules/portal-reachability/portal-reachability.monitor';
import { TypeormNfeSvcAudience } from '../infra/typeorm-nfe-svc-audience';
import {
  svcEnteredEmail,
  svcExitedEmail,
  type SvcEmailInput,
} from './nfe-svc.email';

/** Never e-mail the same kind of SVC change for the same UF and environment more often than this. */
export const MAIL_COOLDOWN_MS = 30 * 60_000;

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
 * with at least one company in that UF in that environment, and an e-mail to the
 * platform operator. Both are best-effort: the fiscal state is already committed.
 */
@Injectable()
export class NfeSvcAnnouncer {
  private readonly logger = new Logger(NfeSvcAnnouncer.name);

  constructor(
    private readonly audience: TypeormNfeSvcAudience,
    private readonly webhooks: FiscalWebhookPublisher,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

  private async publish(
    type: 'nfe.contingency.entered' | 'nfe.contingency.exited',
    change: SvcTransition,
  ): Promise<void> {
    try {
      const environment = change.tpAmb === 1 ? 'live' : 'test';
      for (const tenantId of await this.audience.tenants(
        change.uf,
        change.tpAmb,
      )) {
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

  /** At most one e-mail of each kind per UF and environment in `MAIL_COOLDOWN_MS`. */
  private async mailAllowed(
    event: 'entered' | 'exited',
    change: SvcTransition,
  ): Promise<boolean> {
    try {
      const key = `ops:nfe-svc-mail:${change.uf}:${change.tpAmb}:${event}`;
      const set = await this.redis.set(key, '1', 'PX', MAIL_COOLDOWN_MS, 'NX');
      return set === 'OK';
    } catch {
      // Redis down: better one repeated e-mail than a lost alert.
      return true;
    }
  }

  private async mail(
    rendered: ReturnType<typeof svcEnteredEmail>,
    event: 'entered' | 'exited',
    change: SvcTransition,
  ): Promise<void> {
    if (change.by === undefined && !(await this.mailAllowed(event, change))) {
      this.logger.log(
        { uf: change.uf, tpAmb: change.tpAmb, event },
        'SVC e-mail skipped: already sent in the last 30 minutes',
      );
      return;
    }
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
