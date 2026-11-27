import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import type { IInvoiceRepository } from '@/modules/invoice/domain/invoice.repository';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NfseGetDownloadUrlInput } from '../dto/tool-input.dto';
import { findInvoiceByAccessKey } from './nfse-query.tool';
import { TYPE_PROPERTY } from './nfe.tools';

export const NFSE_GET_DOWNLOAD_URL_TOOL = {
  name: 'nfse_get_download_url',
  description:
    'Generate a temporary signed download URL for the PDF or XML of an authorized NFS-e invoice. The URL expires in one hour. With type "nfe" or "nfce" send invoice_id (the XML is the authorized nfeProc; the PDF is the DANFE, or the DANFCE of 80 mm for a NFC-e).',
  inputSchema: {
    type: 'object',
    properties: {
      type: TYPE_PROPERTY,
      invoice_id: {
        type: 'string',
        description:
          'UUID of the NF-e or NFC-e. Only with type "nfe" or "nfce".',
      },
      access_key: {
        type: 'string',
        description: 'The NFS-e access key (required for NFS-e)',
      },
      format: {
        type: 'string',
        enum: ['pdf', 'xml'],
        description: 'Document format to download',
      },
    },
    required: ['format'],
  },
} as const;

export function createNfseGetDownloadUrlHandler(
  invoiceService: InvoiceService,
  invoiceRepo: Pick<IInvoiceRepository, 'findByAccessKeyAndTenantId'>,
) {
  return async function nfseGetDownloadUrlHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    access_key: string;
    format: 'pdf' | 'xml';
    download_url: string;
    expires_at: string;
    file_name: string;
    mime_type: string;
  }> {
    const params = plainToInstance(
      NfseGetDownloadUrlInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) {
      throw new Error(
        `Invalid input: ${errors.map((error) => error.property).join(', ')}`,
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

    const document = await invoiceService.getDownloadUrl(
      invoice.id,
      ctx.activeTenantId,
      params.format,
      executionEnvironment(ctx),
    );

    return {
      access_key: params.access_key,
      format: params.format,
      download_url: document.url,
      expires_at: document.expiresAt.toISOString(),
      file_name: document.fileName,
      mime_type: document.mimeType,
    };
  };
}
