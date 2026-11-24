import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { AccountantPackageService } from '@/modules/invoice/application/package/accountant-package.service';
import type { InvoicePackageService } from '@/modules/invoice/application/package/invoice-package.service';
import { previousMonth } from '@/modules/invoice/application/package/package-month';
import { invalidInput } from './tool-input-errors';

export class AccountantPackageSendInput {
  @ValidateIf((o: AccountantPackageSendInput) => !o.tax_id)
  @IsUUID()
  company_id?: string;

  @ValidateIf((o: AccountantPackageSendInput) => !o.company_id)
  @IsString()
  tax_id?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional() @IsBoolean() confirm?: boolean;
}

export const ACCOUNTANT_PACKAGE_SEND_TOOL = {
  name: 'accountant_package_send',
  description:
    'Send the month package (ZIP with XML, PDF and resumo.csv of the notes of the month) to the accountant email saved on the company. ' +
    'Without confirm: true nothing is sent: it returns a preview with the month, the recipient email and the note count. ' +
    'Show the preview to the user and only call again with confirm: true after they agree. Sends in the live environment only; the month defaults to the previous one.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: {
        type: 'string',
        description: 'UUID of the company. Use this or tax_id.',
      },
      tax_id: {
        type: 'string',
        description: 'CNPJ of the company (punctuation optional).',
      },
      month: {
        type: 'string',
        description:
          'Competence month, YYYY-MM. Defaults to the previous month.',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to really send. Without it only a preview.',
      },
    },
    required: [],
  },
} as const;

export type AccountantPackageSendResult = {
  sent: boolean;
  status: string;
  company_id: string;
  month: string;
  recipient: string | null;
  note_count: number;
  message: string;
};

export function createAccountantPackageSendHandler(
  companies: Pick<CompanyService, 'findById' | 'findByTaxId'>,
  accountant: Pick<AccountantPackageService, 'getSettings' | 'sendNow'>,
  packages: Pick<InvoicePackageService, 'summary'>,
) {
  return async function accountantPackageSendHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<AccountantPackageSendResult> {
    const params = plainToInstance(
      AccountantPackageSendInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);

    const environment = executionEnvironment(ctx);
    const company = params.company_id
      ? await companies.findById(
          params.company_id,
          ctx.activeTenantId,
          environment,
        )
      : await companies.findByTaxId(
          params.tax_id as string,
          ctx.activeTenantId,
          environment,
        );
    const companyId = company.id;
    const month = params.month ?? previousMonth(new Date());
    const settings = await accountant.getSettings(
      ctx.activeTenantId,
      companyId,
      environment,
    );
    const summary = await packages.summary({
      tenantId: ctx.activeTenantId,
      companyId,
      environment,
      month,
    });
    const base = {
      company_id: companyId,
      month,
      recipient: settings.email,
      note_count: summary.count,
    };

    const tooLarge = summary.count > summary.limit;
    if (params.confirm !== true)
      return {
        ...base,
        sent: false,
        status: 'preview',
        message: tooLarge
          ? `Nothing was sent. The month has more than ${summary.limit} notes, so it cannot be sent by e-mail; download it in parts.`
          : summary.count === 0
            ? 'Nothing was sent. The month has no notes, so there is nothing to send.'
            : 'Nothing was sent. Confirm with the user and call again with confirm: true to send.',
      };

    const status = await accountant.sendNow(
      ctx.activeTenantId,
      companyId,
      environment,
      month,
      'mcp-or-api',
    );
    return {
      ...base,
      sent: status === 'sent',
      status,
      message:
        status === 'sent'
          ? 'Package sent to the accountant.'
          : status === 'skipped-too-large'
            ? `Not sent: the month has more than ${summary.limit} notes; download it in parts.`
            : status === 'skipped-empty'
              ? 'Not sent: the month has no notes.'
              : `Not sent: ${status}.`,
    };
  };
}
