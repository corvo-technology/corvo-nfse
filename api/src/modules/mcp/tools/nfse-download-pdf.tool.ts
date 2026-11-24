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
    'Get the PDF of an authorized NFS-e invoice. By default it returns a temporary signed download link (valid for one hour), the same as nfse_get_download_url: the link is preferred, because the PDF itself is large for an agent to carry. Pass inline: true only when you really need the file content as a base64-encoded string.',
  inputSchema: {
    type: 'object',
    properties: {
      access_key: { type: 'string', description: 'The NFS-e access key' },
      inline: {
        type: 'boolean',
        description:
          'true returns pdf_base64 instead of a link. Default false (link).',
      },
    },
    required: ['access_key'],
  },
} as const;

export type NfseDownloadPdfResult =
  | {
      access_key: string;
      download_url: string;
      expires_at: string;
      file_name: string;
      mime_type: string;
    }
  | { access_key: string; pdf_base64: string };

export function createNfseDownloadPdfHandler(
  invoiceService: InvoiceService,
  invoiceRepo: Pick<IInvoiceRepository, 'findByAccessKeyAndTenantId'>,
) {
  return async function nfseDownloadPdfHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<NfseDownloadPdfResult> {
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

    if (params.inline === true) {
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
    }

    const document = await invoiceService.getDownloadUrl(
      invoice.id,
      ctx.activeTenantId,
      'pdf',
      executionEnvironment(ctx),
    );
    return {
      access_key: params.access_key,
      download_url: document.url,
      expires_at: document.expiresAt.toISOString(),
      file_name: document.fileName,
      mime_type: document.mimeType,
    };
  };
}
