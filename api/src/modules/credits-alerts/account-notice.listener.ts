import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { LockPort } from '@/infra/redis/lock.port';
import {
  runWithoutDatabaseScope,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { BLOCK_REASON_TEXT } from '@/modules/integrations/domain/block-reason-text';
import type { BlockReason } from '@/modules/integrations/domain/integration-operation';
import { friendlyRejectionReason } from '@/modules/invoice/domain/rejection-reason-text';
import { monthLabel } from '@/modules/invoice/application/package/package-month';
import {
  accountantPackageEmptyEmail,
  accountantPackageFailedEmail,
  accountantPackageTooLargeEmail,
  apiKeyCreatedEmail,
  certificateExpiringEmail,
  integrationSaleNeedsAttentionEmail,
  integrationSalesDigestEmail,
  invoiceBlockedOnPortalEmail,
  invoiceCancelledOnPortalEmail,
  invoiceRejectedByTakerEmail,
  nfceContingencyDeadlineEmail,
  creditsAddedEmail,
  creditsExhaustedEmail,
  memberInvitedEmail,
  memberJoinedEmail,
  paymentFailedEmail,
  paymentMismatchEmail,
  pixExpiredEmail,
  subscriptionCanceledEmail,
  invoiceRejectedEmail,
  invoiceRejectedHelpEmail,
  mcpConnectedEmail,
  webhookDeliveryFailedEmail,
  type RenderedEmail,
} from '@/infra/external/email/email-templates';
import { EmailService } from '@/modules/email/application/email.service';
import {
  ACCOUNT_NOTICE,
  type AccountNoticeEvent,
} from '@/shared/events/account-notice.events';
import { LifecycleEmailSettings } from './lifecycle-email.settings';
import { TenantRecipientsService } from './tenant-recipients.service';

const DEFAULT_APP_URL = 'https://www.corvo.tech/app';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Sales that wait for the client: this many e-mails a day per workspace, then one summary. */
const SALE_EMAILS_PER_DAY = 5;
const PLATFORM_NAMES: Record<string, string> = {
  woovi: 'Woovi',
  stripe: 'Stripe',
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
  abacatepay: 'AbacatePay',
  pushinpay: 'PushinPay',
};

/** Turns account events into e-mails for the workspace admins. A failure never affects the action that caused it. */
@Injectable()
export class AccountNoticeListener {
  private readonly logger = new Logger(AccountNoticeListener.name);

  constructor(
    private readonly recipients: TenantRecipientsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    @Optional() private readonly lifecycle?: LifecycleEmailSettings,
  ) {}

  @OnEvent(ACCOUNT_NOTICE)
  async onNotice(event: AccountNoticeEvent): Promise<void> {
    try {
      // The event is emitted inside the caller's async context. When the caller is
      // another tenant's request (a platform admin granting credits), that scope
      // would make runWithTenant refuse the notice's tenant, so start from a clean scope.
      await runWithoutDatabaseScope(() =>
        runWithTenant(event.tenantId, () => this.handle(event)),
      );
    } catch (error) {
      // A notice is best-effort: it must never surface as an unhandled error.
      this.logger.warn({
        event: 'notice_failed',
        tenantId: event.tenantId,
        kind: event.notice.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
        const invoiceUrl = this.page(`invoices/${notice.invoiceId}`);
        message =
          this.lifecycle?.isOn('rejectionHelp') === false
            ? invoiceRejectedEmail({ reason: notice.reason, invoiceUrl })
            : invoiceRejectedHelpEmail({
                reason: friendlyRejectionReason(
                  notice.errorCode,
                  notice.reason,
                ),
                invoiceUrl,
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
      case 'integration-sale-needs-attention': {
        // The same sale is announced once, whatever the number of retries.
        if (
          !(await this.once(
            `integration-sale:${notice.operationId}`,
            30 * DAY_MS,
          ))
        )
          return;
        let slot = 0;
        for (let n = 1; n <= SALE_EMAILS_PER_DAY && slot === 0; n++)
          if (await this.once(`integration-sale-day:${tenantId}:${n}`, DAY_MS))
            slot = n;
        const pending = this.page('invoices?filter=sales');
        if (slot === 0) {
          // Over the daily limit: one summary a day, the rest is in the panel.
          if (!(await this.once(`integration-sale-digest:${tenantId}`, DAY_MS)))
            return;
          message = integrationSalesDigestEmail({
            count: notice.pendingCount,
            listUrl: pending,
          });
        } else {
          const text =
            BLOCK_REASON_TEXT[notice.reason as BlockReason] ??
            BLOCK_REASON_TEXT.invoice_rejected;
          message = integrationSaleNeedsAttentionEmail({
            platform: PLATFORM_NAMES[notice.provider] ?? notice.provider,
            amount: (notice.amountCents / 100).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }),
            date: notice.paidAt.toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            }),
            buyerName: notice.buyerName,
            reasonTitle: text.title,
            reasonAction: text.action,
            saleUrl: this.page(`integrations/sales/${notice.operationId}`),
            pendingCount: notice.pendingCount,
          });
        }
        to = await this.recipients.ownerEmailsFor(tenantId);
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
          name: notice.name,
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
      case 'accountant-package-failed': {
        const key = `accountant-package:${notice.companyId}:${notice.month}`;
        if (!(await this.once(key, 40 * DAY_MS))) return;
        message = accountantPackageFailedEmail({
          companyName: notice.companyName,
          monthLabel: monthLabel(notice.month),
          companyUrl: this.page(`companies/${notice.companyId}`),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'accountant-package-empty': {
        const key = `accountant-package-empty:${notice.companyId}:${notice.month}`;
        if (!(await this.once(key, 40 * DAY_MS))) return;
        message = accountantPackageEmptyEmail({
          companyName: notice.companyName,
          monthLabel: monthLabel(notice.month),
          companyUrl: this.page(`companies/${notice.companyId}`),
        });
        to = await this.recipients.ownerEmailsFor(tenantId);
        break;
      }
      case 'accountant-package-too-large': {
        const key = `accountant-package-too-large:${notice.companyId}:${notice.month}`;
        if (!(await this.once(key, 40 * DAY_MS))) return;
        message = accountantPackageTooLargeEmail({
          companyName: notice.companyName,
          monthLabel: monthLabel(notice.month),
          count: notice.count,
          limit: notice.limit,
          companyUrl: this.page(`companies/${notice.companyId}`),
        });
        to = await this.recipients.ownerEmailsFor(tenantId);
        break;
      }
      case 'invoice-cancelled-on-portal': {
        if (
          !(await this.once(
            `portal:cancelled:${notice.invoiceId}`,
            30 * DAY_MS,
          ))
        )
          return;
        message = invoiceCancelledOnPortalEmail({
          nfseNumber: notice.nfseNumber,
          reason: notice.reason,
          invoiceUrl: this.page(`invoices/${notice.invoiceId}`),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'invoice-rejected-by-taker': {
        if (!(await this.once(`portal:taker:${notice.invoiceId}`, 30 * DAY_MS)))
          return;
        message = invoiceRejectedByTakerEmail({
          nfseNumber: notice.nfseNumber,
          reason: notice.reason,
          invoiceUrl: this.page(`invoices/${notice.invoiceId}`),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'nfce-contingency-deadline': {
        if (
          !(await this.once(`nfce:deadline:${notice.documentId}`, 3 * DAY_MS))
        )
          return;
        message = nfceContingencyDeadlineEmail({
          number: notice.number,
          deadline: `${notice.deadlineAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)`,
          documentUrl: this.page(`nfe/${notice.documentId}`),
        });
        to = await this.recipients.ownerEmailsFor(tenantId);
        break;
      }
      case 'invoice-blocked-on-portal': {
        if (
          !(await this.once(`portal:blocked:${notice.invoiceId}`, 30 * DAY_MS))
        )
          return;
        message = invoiceBlockedOnPortalEmail({
          nfseNumber: notice.nfseNumber,
          invoiceUrl: this.page(`invoices/${notice.invoiceId}`),
        });
        to = await this.recipients.emailsFor(tenantId);
        break;
      }
      case 'webhook-delivery-failed': {
        // One warning per hour for each webhook: an endpoint that is down must not fill the inbox.
        if (
          !(await this.once(
            `webhook-failed:${notice.webhookConfigId}`,
            HOUR_MS,
          ))
        )
          return;
        message = webhookDeliveryFailedEmail({
          eventType: notice.eventType,
          webhooksUrl: this.page('webhooks'),
        });
        to = await this.recipients.ownerEmailsFor(tenantId);
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
