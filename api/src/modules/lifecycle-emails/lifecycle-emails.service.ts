import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  firstInvoiceEmail,
  monthlySummaryEmail,
  paymentPendingEmail,
  type RenderedEmail,
} from '@/infra/external/email/email-templates';
import {
  runWithoutDatabaseScope,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { TenantRecipientsService } from '@/modules/credits-alerts/tenant-recipients.service';
import { EmailService } from '@/modules/email/application/email.service';
import {
  monthLabel,
  previousMonth,
} from '@/modules/invoice/application/package/package-month';
import {
  LIVE_INVOICE_AUTHORIZED,
  type LiveInvoiceAuthorizedEvent,
} from '@/shared/events/live-invoice-authorized.events';
import { brtDayStart, brtMonthWindow } from './brt-time';
import { LifecycleEmailSettings } from '@/modules/credits-alerts/lifecycle-email.settings';
import {
  LifecycleEmailLedger,
  type LifecycleEmailKind,
} from './infra/lifecycle-email.ledger';
import { LifecycleStatsRepository } from './infra/lifecycle-stats.repository';

const DEFAULT_APP_URL = 'https://www.corvo.tech/app';
const HOUR_MS = 3_600_000;
/** A purchase is reminded about from 24 hours after it started, for as long as 3 days. */
const REMINDER_AFTER_MS = 24 * HOUR_MS;
const REMINDER_UNTIL_MS = 72 * HOUR_MS;
const YEAR_MS = 365 * 24 * HOUR_MS;

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export type LifecycleOutcome =
  | 'sent'
  | 'off'
  | 'nothing-to-report'
  | 'daily-limit'
  | 'already-sent'
  | 'no-recipients'
  | 'failed';

/**
 * The owner-facing lifecycle e-mails: first live invoice, monthly summary and pending payment.
 * Rules shared by all: live data only, at most one of these e-mails per workspace per day, and
 * never twice for the same period (the ledger's unique key decides, so two workers cannot race).
 */
@Injectable()
export class LifecycleEmailsService {
  private readonly logger = new Logger(LifecycleEmailsService.name);

  constructor(
    private readonly settings: LifecycleEmailSettings,
    private readonly ledger: LifecycleEmailLedger,
    private readonly stats: LifecycleStatsRepository,
    private readonly recipients: TenantRecipientsService,
    private readonly usage: BillingUsageService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
  ) {}

  private page(path: string): string {
    const base = (this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL)
      .replace(/\/+$/, '')
      .replace(/\/app$/, '');
    return `${base}/app/${path}`;
  }

  /**
   * Common path: daily limit, build the message, claim the period, queue it. A failure after the
   * claim gives the claim back, so the next run can try again.
   */
  private async deliver(
    tenantId: string,
    kind: LifecycleEmailKind,
    period: string,
    build: () => Promise<RenderedEmail | null>,
    now: Date,
  ): Promise<LifecycleOutcome> {
    try {
      if ((await this.ledger.countSince(tenantId, brtDayStart(now))) > 0)
        return 'daily-limit';
      const message = await build();
      if (!message) return 'nothing-to-report';
      if (!(await this.ledger.claim(tenantId, kind, period)))
        return 'already-sent';
      try {
        const to = await this.recipients.ownerEmailsFor(tenantId);
        if (to.length === 0) {
          await this.ledger.release(tenantId, kind, period);
          this.logger.warn({
            event: 'lifecycle_email_no_recipients',
            tenantId,
            kind,
          });
          return 'no-recipients';
        }
        for (const address of to)
          await this.email.enqueueNotice(address, message);
        this.logger.log({
          event: 'lifecycle_email_sent',
          tenantId,
          kind,
          recipients: to.length,
        });
        return 'sent';
      } catch (error) {
        await this.ledger.release(tenantId, kind, period);
        throw error;
      }
    } catch (error) {
      // Best effort: a lifecycle e-mail never breaks the work that triggered it.
      this.logger.warn({
        event: 'lifecycle_email_failed',
        tenantId,
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }

  /** The first live invoice of a workspace: one e-mail, ever. */
  @OnEvent(LIVE_INVOICE_AUTHORIZED)
  async onLiveInvoiceAuthorized(
    event: LiveInvoiceAuthorizedEvent,
  ): Promise<LifecycleOutcome> {
    if (!this.settings.isOn('firstInvoice')) return 'off';
    try {
      // The event comes from inside another request or job: start from a clean scope.
      return await runWithoutDatabaseScope(() =>
        runWithTenant(event.tenantId, () => this.firstInvoice(event)),
      );
    } catch (error) {
      this.logger.warn({
        event: 'lifecycle_email_failed',
        tenantId: event.tenantId,
        kind: 'first-invoice',
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }

  private async firstInvoice(
    event: LiveInvoiceAuthorizedEvent,
  ): Promise<LifecycleOutcome> {
    // Every authorization comes here: after the first one, this marker stops the database check.
    const marker = await this.locks.acquire(
      `lifecycle:first-invoice:${event.tenantId}`,
      { ttlMs: YEAR_MS },
    );
    if (!marker) return 'already-sent';
    const outcome = await this.firstInvoiceOutcome(event);
    // Give the marker back when it can be tried again; otherwise it stays for good.
    if (outcome === 'failed' || outcome === 'no-recipients')
      await this.locks.release(marker);
    return outcome;
  }

  private async firstInvoiceOutcome(
    event: LiveInvoiceAuthorizedEvent,
  ): Promise<LifecycleOutcome> {
    if (
      await this.stats.hasEarlierLiveAuthorization(
        event.tenantId,
        event.invoiceId,
        event.authorizedAt,
      )
    )
      return 'nothing-to-report';
    return this.deliver(
      event.tenantId,
      'first-invoice',
      'once',
      () =>
        Promise.resolve(
          firstInvoiceEmail({
            customerEmailed: event.customerEmailed,
            integrationsUrl: this.page('integrations'),
          }),
        ),
      new Date(),
    );
  }

  /** The month that ended: what was issued, rejected and what is left. Called for one workspace. */
  async sendMonthlySummary(
    tenantId: string,
    now = new Date(),
  ): Promise<LifecycleOutcome> {
    if (!this.settings.isOn('monthlySummary')) return 'off';
    const month = previousMonth(now);
    return this.deliver(
      tenantId,
      'monthly-summary',
      month,
      async () => {
        const { start, end } = brtMonthWindow(month);
        const summary = await this.stats.monthSummary(tenantId, start, end);
        if (summary.count === 0) return null;
        const status = await this.usage.status(tenantId);
        return monthlySummaryEmail({
          monthLabel: monthLabel(month),
          count: summary.count,
          total: brl.format(summary.totalCents / 100),
          topCustomers: summary.topCustomers,
          rejected: summary.rejected,
          creditsRemaining: status.included_remaining + status.avulsoBalance,
          hasAccountant: summary.mainCompany?.hasAccountant ?? false,
          accountantUrl: this.page(
            summary.mainCompany
              ? `companies/${summary.mainCompany.id}`
              : 'companies',
          ),
        });
      },
      now,
    );
  }

  /** One reminder for a checkout left unpaid for a day. Called for one workspace. */
  async sendPaymentReminder(
    tenantId: string,
    now = new Date(),
  ): Promise<LifecycleOutcome> {
    if (!this.settings.isOn('pendingPayment')) return 'off';
    const pending = await runWithTenant(tenantId, () =>
      this.stats.pendingPurchases(
        tenantId,
        new Date(now.getTime() - REMINDER_UNTIL_MS),
        new Date(now.getTime() - REMINDER_AFTER_MS),
      ),
    );
    // Only the newest purchase is mentioned; the older ones count as reminded with it.
    for (const purchase of pending) {
      const outcome = await this.deliver(
        tenantId,
        'payment-pending',
        purchase.id,
        () =>
          Promise.resolve(
            paymentPendingEmail({
              what:
                purchase.kind === 'avulso' && purchase.units
                  ? `${purchase.units} ${purchase.units === 1 ? 'nota' : 'notas'}`
                  : 'uma assinatura do Corvo',
              billingUrl: this.page('billing'),
            }),
          ),
        now,
      );
      if (outcome === 'already-sent') continue;
      if (outcome === 'sent')
        for (const older of pending)
          if (older.id !== purchase.id)
            await this.ledger.claim(tenantId, 'payment-pending', older.id);
      return outcome;
    }
    return 'nothing-to-report';
  }
}
