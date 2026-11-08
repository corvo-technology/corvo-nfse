import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { LockPort } from '@/infra/redis/lock.port';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  apiKeyCreatedEmail,
  certificateExpiringEmail,
  creditsAddedEmail,
  creditsExhaustedEmail,
  memberInvitedEmail,
  memberJoinedEmail,
  paymentFailedEmail,
  paymentMismatchEmail,
  pixExpiredEmail,
  subscriptionCanceledEmail,
  invoiceRejectedEmail,
  mcpConnectedEmail,
  type RenderedEmail,
} from '@/infra/external/email/email-templates';
import { EmailService } from '@/modules/email/application/email.service';
import {
  ACCOUNT_NOTICE,
  type AccountNoticeEvent,
} from '@/shared/events/account-notice.events';
import { TenantRecipientsService } from './tenant-recipients.service';

const DEFAULT_APP_URL = 'https://corvo.tech/app';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Turns account events into e-mails for the workspace admins. A failure never affects the action that caused it. */
@Injectable()
export class AccountNoticeListener {
  private readonly logger = new Logger(AccountNoticeListener.name);

  constructor(
    private readonly recipients: TenantRecipientsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
  ) {}

  @OnEvent(ACCOUNT_NOTICE)
  async onNotice(event: AccountNoticeEvent): Promise<void> {
    await runWithTenant(event.tenantId, () => this.handle(event));
  }

  private page(path: string): string {
    const base = (this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL)
      .replace(/\/+$/, '')
      .replace(/\/app$/, '');
    return `${base}/app/${path}`;
  }

  private site(path: string): string {
    return `${(this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL)
      .replace(/\/+$/, '')
      .replace(/\/app$/, '')}/${path}`;
  }

  /** True the first time `key` is seen inside `ttlMs`: the same notice is not repeated. */
  private async once(key: string, ttlMs: number): Promise<boolean> {
    return (await this.locks.acquire(`notice:${key}`, { ttlMs })) !== null;
  }

  async handle({ tenantId, notice }: AccountNoticeEvent): Promise<void> {
    let message: RenderedEmail;
    let to: string[];
    switch (notice.kind) {
      case 'credits-added':
        message = creditsAddedEmail({
          units: notice.units,
          billingUrl: this.page('billing'),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      case 'invoice-rejected': {
        // One warning per hour: a big import must not fill the inbox.
        const first = await this.locks.acquire(`notice:rejected:${tenantId}`, {
          ttlMs: HOUR_MS,
        });
        if (!first) return;
        message = invoiceRejectedEmail({
          reason: notice.reason,
          invoiceUrl: this.page(`invoices/${notice.invoiceId}`),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'credits-exhausted': {
        if (!(await this.once(`exhausted:${tenantId}`, DAY_MS))) return;
        message = creditsExhaustedEmail({ billingUrl: this.page('billing') });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'payment-failed': {
        if (!(await this.once(`payment-failed:${tenantId}`, DAY_MS))) return;
        message = paymentFailedEmail({ billingUrl: this.page('billing') });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'pix-expired':
        message = pixExpiredEmail({ billingUrl: this.page('billing') });
        to = await this.recipients.emailsFor(tenantId);
        break;
      case 'payment-mismatch':
        message = paymentMismatchEmail({ billingUrl: this.page('billing') });
        to = await this.recipients.emailsFor(tenantId);
        break;
      case 'subscription-canceled':
        message = subscriptionCanceledEmail({
          billingUrl: this.page('billing'),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      case 'member-invited':
        // The token goes only into this one e-mail, in the URL fragment so it is never sent to a server.
        message = memberInvitedEmail({
          role: notice.role,
          inviterName: notice.inviterName,
          acceptUrl: `${this.site('accept-invite')}#token=${encodeURIComponent(notice.token)}`,
        });
        to = [notice.email];
        break;
      case 'member-joined':
        message = memberJoinedEmail({
          name: notice.name,
          email: notice.email,
          role: notice.role,
          membersUrl: this.page('members'),
        });
        to = await this.recipients.ownerEmailsFor(tenantId);
        break;
      case 'certificate-expiring': {
        const key = `cert:${notice.companyId}:${notice.stage}`;
        if (!(await this.once(key, 40 * DAY_MS))) return;
        message = certificateExpiringEmail({
          companyName: notice.companyName,
          stage: notice.stage,
          validUntil: notice.validUntil.toLocaleDateString('pt-BR'),
          certificateUrl: this.page(`companies/${notice.companyId}`),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'api-key-created':
        message = apiKeyCreatedEmail({
          name: notice.name,
          keysUrl: this.page('api-keys'),
        });
        to = await this.recipients.adminEmailsFor(tenantId);
        break;
      case 'mcp-connected':
        message = mcpConnectedEmail({
          clientName: notice.clientName,
          connectionsUrl: this.page('agents'),
        });
        to = await this.recipients.adminEmailsFor(tenantId);
        break;
    }
    if (to.length === 0) {
      this.logger.warn({
        event: 'notice_no_recipients',
        tenantId,
        kind: notice.kind,
      });
      return;
    }
    for (const address of to) await this.email.enqueueNotice(address, message);
    this.logger.log({
      event: 'notice_sent',
      tenantId,
      kind: notice.kind,
      recipients: to.length,
    });
  }
}
