import type { IInvoiceRepository } from '@/modules/invoice/domain/invoice.repository';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { NfseDownloadPdfInput } from '../dto/tool-input.dto';
import { findInvoiceByAccessKey } from './nfse-query.tool';

export const NFSE_DOWNLOAD_PDF_TOOL = {
  name: 'nfse_download_pdf',
  description:
    'Download the PDF of an authorized NFS-e invoice as base64-encoded string.',
  inputSchema: {
    type: 'object',
    properties: {
      access_key: { type: 'string', description: 'The NFS-e access key' },
    },
    required: ['access_key'],
  },
} as const;

export function createNfseDownloadPdfHandler(
  invoiceService: InvoiceService,
  invoiceRepo: Pick<IInvoiceRepository, 'findByAccessKeyAndTenantId'>,
) {
  return async function nfseDownloadPdfHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ access_key: string; pdf_base64: string }> {
    const params = plainToInstance(
      NfseDownloadPdfInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) {
      throw new Error(
        `Invalid input: ${errors.map((e) => e.property).join(', ')}`,
      );
    }

    const invoice = await findInvoiceByAccessKey(
      invoiceRepo,
      params.access_key,
      ctx,
    );
    if (!invoice) {
      throw new Error(`Invoice not found for access key: ${params.access_key}`);
    }

    // Real getPdf(): throws NotFoundException unless the invoice is authorized.
    const pdf = await invoiceService.getPdf(
      invoice.id,
      ctx.activeTenantId,
      executionEnvironment(ctx),
    );

    return {
      access_key: params.access_key,
      pdf_base64: pdf.toString('base64'),
    };
  };
}
