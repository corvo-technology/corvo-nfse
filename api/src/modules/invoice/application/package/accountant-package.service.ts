import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import {
  accountantPackageEmail,
  accountantWelcomeEmail,
} from '@/infra/external/email/email-templates';
import { EmailService } from '@/modules/email/application/email.service';
import {
  AccountAuditRecorder,
  SYSTEM_ACTOR,
} from '@/modules/account-audit/domain/account-audit';
import { recordSafely } from '@/shared/audit/record-safely';
import { formatTaxId } from '../../infra/danfse/danfse-format';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  IAccountantPackageRepository,
  type AccountantCompany,
  type AccountantSendRecord,
  type AccountantSendRecordStatus,
  type AccountantSendTrigger,
} from '../../domain/accountant-package.repository';
import { PackageLinkService } from './package-link.service';
import { InvoicePackageService, parseMonth } from './invoice-package.service';
import { monthLabel, previousMonth } from './package-month';

export type AccountantSendStatus =
  | 'sent'
  | 'skipped-test'
  | 'skipped-no-email'
  | 'skipped-empty'
  | 'skipped-too-large'
  | 'skipped-already-sent';

export interface AccountantSettings {
  email: string | null;
  lastSentMonth: string | null;
}

export interface AccountantSettingsUpdate extends AccountantSettings {
  /** True when a test e-mail was queued to the new address (only when the address changed). */
  testEmailSent: boolean;
}

export interface AccountantSendView {
  id: string;
  month: string;
  recipient: string;
  invoiceCount: number;
  totalCents: number;
  status: AccountantSendRecordStatus;
  trigger: AccountantSendTrigger;
  createdAt: string;
}

const HISTORY_LIMIT = 12;

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const day = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Sends the month package to the accountant a company chose, by e-mail link. */
@Injectable()
export class AccountantPackageService {
  private readonly logger = new Logger(AccountantPackageService.name);

  constructor(
    private readonly companies: IAccountantPackageRepository,
    private readonly packages: InvoicePackageService,
    private readonly links: PackageLinkService,
    private readonly email: EmailService,
    private readonly events: ApplicationEventBus,
    private readonly audit: AccountAuditRecorder,
  ) {}

  private auditTarget(company: AccountantCompany) {
    return {
      type: 'company' as const,
      id: company.id,
      label: formatTaxId(company.taxId),
    };
  }

  private async find(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
  ): Promise<AccountantCompany> {
    const company = await this.companies.find(tenantId, companyId, environment);
    if (!company)
      throw new NotFoundException({
        code: 'COMPANY_NOT_FOUND',
        message: 'Company not found',
      });
    return company;
  }

  async getSettings(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
  ): Promise<AccountantSettings> {
    const company = await this.find(tenantId, companyId, environment);
    return {
      email: company.accountantEmail,
      lastSentMonth: company.lastSentMonth,
    };
  }

  /** `null` (or blank) turns the monthly send off. */
  async setEmail(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
    email: string | null,
  ): Promise<AccountantSettingsUpdate> {
    const value = email?.trim().toLowerCase() || null;
    if (value && (value.length > 254 || !isEmail(value)))
      throw new BadRequestException({
        code: 'ACCOUNTANT_EMAIL_INVALID',
        message: 'accountantEmail must be a valid e-mail address',
      });
    const company = await this.find(tenantId, companyId, environment);
    await this.companies.setEmail(tenantId, company.id, value);
    if (value !== company.accountantEmail)
      await recordSafely(this.audit, {
        tenantId,
        environment: company.environment,
        action: 'accountant.email_changed',
        target: this.auditTarget(company),
      });
    // A short hello to the new address, so a wrong recipient is noticed. Never twice for the same address.
    const testEmailSent =
      value !== null &&
      value !== company.accountantEmail &&
      company.environment === 'live' &&
      (await this.sendWelcome(company, value));
    return {
      email: value,
      lastSentMonth: company.lastSentMonth,
      testEmailSent,
    };
  }

  private async sendWelcome(
    company: AccountantCompany,
    to: string,
  ): Promise<boolean> {
    try {
      await this.email.enqueueNotice(
        to,
        accountantWelcomeEmail({
          companyName: company.name,
          companyTaxId: company.taxId,
        }),
      );
      return true;
    } catch (error) {
      // Saving the address must not fail because the hello could not be queued.
      this.logger.warn({
        event: 'accountant_welcome_failed',
        tenantId: company.tenantId,
        companyId: company.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** The last attempts to send a package, newest first. */
  async listSends(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
  ): Promise<AccountantSendView[]> {
    const company = await this.find(tenantId, companyId, environment);
    const rows = await this.companies.listSends(
      tenantId,
      company.id,
      HISTORY_LIMIT,
    );
    return rows.map(
      ({ createdAt, ...row }: AccountantSendRecord): AccountantSendView => ({
        ...row,
        createdAt: createdAt.toISOString(),
      }),
    );
  }

  /** "Send now": an explicit request, so it does not stop at an already-sent month. */
  async sendNow(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
    month: string,
    trigger: AccountantSendTrigger = 'manual',
  ): Promise<AccountantSendStatus> {
    parseMonth(month);
    const company = await this.find(tenantId, companyId, environment);
    try {
      return await this.deliver(company, month, { force: true, trigger });
    } catch (error) {
      await this.record(company, month, 'failed', trigger);
      throw error;
    }
  }

  /**
   * The monthly job for one workspace: every live company with an accountant e-mail gets the
   * previous month. A failure is retried by the next run; `lastAttempt` also warns the owner.
   */
  async sendMonthly(
    tenantId: string,
    now: Date,
    lastAttempt: boolean,
  ): Promise<void> {
    const month = previousMonth(now);
    for (const company of await this.companies.listEnabled(tenantId)) {
      try {
        const status = await this.deliver(company, month, {
          force: false,
          trigger: 'scheduled',
        });
        this.logger.log({
          event: 'accountant_package',
          tenantId,
          companyId: company.id,
          month,
          status,
        });
      } catch (error) {
        this.logger.error({
          event: 'accountant_package_failed',
          tenantId,
          companyId: company.id,
          month,
          error: error instanceof Error ? error.message : String(error),
        });
        if (lastAttempt) {
          await this.record(company, month, 'failed', 'scheduled');
          this.events.publishBestEffort(
            accountNotice(tenantId, {
              kind: 'accountant-package-failed',
              companyId: company.id,
              companyName: company.name,
              month,
            }),
          );
        }
      }
    }
  }

  private async deliver(
    company: AccountantCompany,
    month: string,
    { force, trigger }: { force: boolean; trigger: AccountantSendTrigger },
  ): Promise<AccountantSendStatus> {
    if (company.environment !== 'live') return 'skipped-test';
    const to = company.accountantEmail;
    if (!to) return 'skipped-no-email';
    if (!force && company.lastSentMonth === month)
      return 'skipped-already-sent';
    const scope = {
      tenantId: company.tenantId,
      companyId: company.id,
      environment: 'live' as const,
      month,
    };
    const summary = await this.packages.summary(scope);
    const total = {
      invoiceCount: summary.count,
      totalCents: Math.round(Number(summary.total) * 100),
    };
    if (summary.count === 0 || summary.count > summary.limit) {
      const empty = summary.count === 0;
      const status = empty ? 'skipped-empty' : 'skipped-too-large';
      // The hourly runs repeat the same skip: record it, and warn the owners, only the first time.
      if (trigger === 'scheduled') {
        if (
          await this.companies.hasSend(
            company.tenantId,
            company.id,
            month,
            status,
          )
        )
          return status;
        await this.record(company, month, status, trigger, total);
        this.events.publishBestEffort(
          accountNotice(
            company.tenantId,
            empty
              ? {
                  kind: 'accountant-package-empty',
                  companyId: company.id,
                  companyName: company.name,
                  month,
                }
              : {
                  kind: 'accountant-package-too-large',
                  companyId: company.id,
                  companyName: company.name,
                  month,
                  count: summary.count,
                  limit: summary.limit,
                },
          ),
        );
      } else await this.record(company, month, status, trigger, total);
      return status;
    }

    // Claim the month first: two runs at once cannot both pass this update.
    if (
      !(await this.companies.claimMonth(
        company.tenantId,
        company.id,
        month,
        force,
      ))
    )
      return 'skipped-already-sent';
    try {
      const { token, expiresAt } = this.links.create(scope);
      await this.email.enqueueNotice(
        to,
        accountantPackageEmail({
          companyName: summary.companyName,
          companyTaxId: summary.companyTaxId,
          monthLabel: monthLabel(month),
          count: summary.count,
          total: brl.format(Number(summary.total)),
          downloadUrl: this.links.url(token),
          expiresOn: day.format(expiresAt),
        }),
      );
    } catch (error) {
      await this.companies.setLastSentMonth(
        company.tenantId,
        company.id,
        company.lastSentMonth,
      );
      throw error;
    }
    await this.record(company, month, 'sent', trigger, total);
    await recordSafely(this.audit, {
      tenantId: company.tenantId,
      environment: company.environment,
      action: 'accountant.package_sent',
      target: this.auditTarget(company),
      metadata: { month, invoice_count: total.invoiceCount },
      // The monthly job has no request: it is "Sistema".
      ...(trigger === 'scheduled' ? { actor: SYSTEM_ACTOR } : {}),
    });
    return 'sent';
  }

  /** History is best-effort: losing a row must never undo or repeat a send. */
  private async record(
    company: AccountantCompany,
    month: string,
    status: AccountantSendRecordStatus,
    trigger: AccountantSendTrigger,
    total = { invoiceCount: 0, totalCents: 0 },
  ): Promise<void> {
    try {
      await this.companies.recordSend({
        tenantId: company.tenantId,
        companyId: company.id,
        month,
        recipient: company.accountantEmail ?? '',
        status,
        trigger,
        ...total,
      });
    } catch (error) {
      this.logger.warn({
        event: 'accountant_package_history_failed',
        tenantId: company.tenantId,
        companyId: company.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
