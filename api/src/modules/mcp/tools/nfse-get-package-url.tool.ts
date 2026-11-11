import { plainToInstance } from 'class-transformer';
import { IsString, Matches, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { InvoicePackageService } from '@/modules/invoice/application/package/invoice-package.service';
import type { PackageLinkService } from '@/modules/invoice/application/package/package-link.service';

export class NfseGetPackageUrlInput {
  @IsString() tax_id!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
}

export const NFSE_GET_PACKAGE_URL_TOOL = {
  name: 'nfse_get_package_url',
  description:
    'Generate a temporary download link for the month package of one company: a ZIP with the XML and PDF of every authorized or cancelled NFS-e whose competence is in the month, plus resumo.csv for the accountant. The link opens without login and expires in 7 days. Fails when the month has no notes or more than 500.',
  inputSchema: {
    type: 'object',
    properties: {
      tax_id: {
        type: 'string',
        description: 'CNPJ of the company (punctuation optional)',
      },
      month: {
        type: 'string',
        description: 'Competence month, YYYY-MM',
      },
    },
    required: ['tax_id', 'month'],
  },
} as const;

export function createNfseGetPackageUrlHandler(
  companies: Pick<CompanyService, 'findByTaxId'>,
  packages: Pick<InvoicePackageService, 'summary'>,
  links: Pick<PackageLinkService, 'create' | 'url'>,
) {
  return async function nfseGetPackageUrlHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    month: string;
    note_count: number;
    download_url: string;
    expires_at: string;
    mime_type: 'application/zip';
  }> {
    const params = plainToInstance(
      NfseGetPackageUrlInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) {
      throw new Error(
        `Invalid input: ${errors.map((error) => error.property).join(', ')}`,
      );
    }
    const environment = executionEnvironment(ctx);
    const company = await companies.findByTaxId(
      params.tax_id,
      ctx.activeTenantId,
      environment,
    );
    const scope = {
      tenantId: ctx.activeTenantId,
      companyId: company.id,
      environment,
      month: params.month,
    };
    const summary = await packages.summary(scope);
    if (summary.count === 0)
      throw new Error(`No authorized or cancelled notes in ${params.month}`);
    if (summary.count > summary.limit)
      throw new Error(
        `This month has ${summary.count} notes; the package holds at most ${summary.limit}`,
      );
    const { token, expiresAt } = links.create(scope);
    return {
      month: params.month,
      note_count: summary.count,
      download_url: links.url(token),
      expires_at: expiresAt.toISOString(),
      mime_type: 'application/zip',
    };
  };
}
