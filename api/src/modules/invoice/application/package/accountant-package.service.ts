import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { accountantPackageEmail } from '@/infra/external/email/email-templates';
import { EmailService } from '@/modules/email/application/email.service';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  IAccountantPackageRepository,
  type AccountantCompany,
} from '../../domain/accountant-package.repository';
import { PackageLinkService } from './package-link.service';
import { InvoicePackageService, parseMonth } from './invoice-package.service';
import { monthLabel, previousMonth } from './package-month';

export type AccountantSendStatus =
  | 'sent'
  | 'skipped-test'
  | 'skipped-no-email'
  | 'skipped-empty'
  | 'skipped-already-sent';

export interface AccountantSettings {
  email: string | null;
  lastSentMonth: string | null;
}

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
  ) {}

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
  ): Promise<AccountantSettings> {
    const value = email?.trim().toLowerCase() || null;
    if (value && (value.length > 254 || !isEmail(value)))
      throw new BadRequestException({
        code: 'ACCOUNTANT_EMAIL_INVALID',
        message: 'accountantEmail must be a valid e-mail address',
      });
    const company = await this.find(tenantId, companyId, environment);
    await this.companies.setEmail(tenantId, company.id, value);
    return { email: value, lastSentMonth: company.lastSentMonth };
  }

  /** "Send now": an explicit request, so it does not stop at an already-sent month. */
  async sendNow(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
    month: string,
  ): Promise<AccountantSendStatus> {
    parseMonth(month);
    return this.deliver(
      await this.find(tenantId, companyId, environment),
      month,
      {
        force: true,
      },
    );
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
        const status = await this.deliver(company, month, { force: false });
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
        if (lastAttempt)
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

  private async deliver(
    company: AccountantCompany,
    month: string,
    { force }: { force: boolean },
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
    if (summary.count === 0) return 'skipped-empty';

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
    return 'sent';
  }
}
