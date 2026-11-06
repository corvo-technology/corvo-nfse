import { Inject, Injectable, Logger } from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import { TenantRecipientsService } from '@/modules/credits-alerts/tenant-recipients.service';
import { EmailService } from '@/modules/email/application/email.service';
import type { InvoiceSchedule } from '../domain/invoice-schedule';
import {
  ScheduleFailureNotifier,
  type FailedScheduleItem,
} from '../domain/schedule-failure.notifier';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** E-mails the workspace's admins and billing members about a schedule that could not run. */
@Injectable()
export class ScheduleEmailNotifier extends ScheduleFailureNotifier {
  private readonly logger = new Logger(ScheduleEmailNotifier.name);

  constructor(
    private readonly recipients: TenantRecipientsService,
    private readonly email: EmailService,
    @Inject(CompanyService)
    private readonly companies: Pick<CompanyService, 'findById'>,
  ) {
    super();
  }

  async retryNotice(
    tenantId: string,
    items: FailedScheduleItem[],
  ): Promise<void> {
    const to = await this.recipients.emailsFor(tenantId);
    if (to.length === 0) return this.noRecipients(tenantId);
    const lines = await Promise.all(items.map((item) => this.describe(item)));
    const reason = [...new Set(items.map(reasonText))].join('; ');
    for (const address of to)
      await this.email.enqueueScheduleRetry({
        to: address,
        count: items.length,
        schedules: lines.join('; '),
        reason,
      });
  }

  async paused(item: FailedScheduleItem): Promise<void> {
    const { tenantId } = item.schedule.props;
    const to = await this.recipients.emailsFor(tenantId);
    if (to.length === 0) return this.noRecipients(tenantId);
    const companyName = await this.companyName(item.schedule);
    const amount = formatAmount(item.schedule);
    for (const address of to)
      await this.email.enqueueSchedulePaused({
        to: address,
        companyName,
        amount: amount ?? '',
        reason: reasonText(item),
      });
  }

  private async describe(item: FailedScheduleItem): Promise<string> {
    const name = await this.companyName(item.schedule);
    const amount = formatAmount(item.schedule);
    return amount ? `${name} (${amount})` : name;
  }

  private async companyName(schedule: InvoiceSchedule): Promise<string> {
    try {
      const company = await this.companies.findById(
        schedule.props.companyId,
        schedule.props.tenantId,
        schedule.props.environment,
      );
      return company.tradeName?.trim() || company.legalName;
    } catch {
      return 'sua empresa';
    }
  }

  private noRecipients(tenantId: string): void {
    this.logger.warn({
      event: 'invoice_schedule_notice_no_recipients',
      tenantId,
    });
  }
}

/**
 * Billing refusals get a plain explanation. The batch reports them as `monthly_limit_exceeded`,
 * `daily_limit_exceeded` and `plan_blocked` (with or without the ERROR_ prefix); the HTTP path as
 * ERROR_QUOTA_EXCEEDED. Anything else carries the refusal message.
 */
function reasonText(item: FailedScheduleItem): string {
  if (/PLAN_BLOCKED/i.test(item.code))
    return 'o plano está bloqueado (assinatura pendente ou carência vencida)';
  if (/DAILY_LIMIT/i.test(item.code))
    return 'o limite diário de emissão foi atingido';
  if (/MONTHLY_LIMIT|QUOTA|CREDIT/i.test(item.code))
    return 'não há notas disponíveis na sua conta';
  return item.reason;
}

/** The invoice's total, from `amount` or from the itemized services. */
function formatAmount(schedule: InvoiceSchedule): string | null {
  const input = schedule.props.invoiceInput;
  let total: number | null =
    typeof input.amount === 'number' ? input.amount : null;
  if (total === null && Array.isArray(input.services))
    total = (input.services as Array<Record<string, unknown>>).reduce(
      (sum, service) =>
        sum + Number(service.quantity ?? 0) * Number(service.unit_price ?? 0),
      0,
    );
  return total === null ? null : BRL.format(total);
}
