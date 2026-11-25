import type { IInvoiceRepository } from '@/modules/invoice/domain/invoice.repository';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { Invoice } from '@/modules/invoice/domain/invoice';
import { NfseQueryInput } from '../dto/tool-input.dto';

export const NFSE_QUERY_TOOL = {
  name: 'nfse_query',
  description: 'Query the status of an NFS-e invoice by its access key.',
  inputSchema: {
    type: 'object',
    properties: {
      access_key: {
        type: 'string',
        description: 'The NFS-e access key (chave de acesso)',
      },
    },
    required: ['access_key'],
  },
} as const;

/** Lookup always uses the repository's tenant and environment contract. */
export async function findInvoiceByAccessKey(
  invoiceRepo: Pick<IInvoiceRepository, 'findByAccessKeyAndTenantId'>,
  accessKey: string,
  ctx: AuthContext,
): Promise<Invoice | null> {
  return invoiceRepo.findByAccessKeyAndTenantId(
    accessKey,
    ctx.activeTenantId,
    executionEnvironment(ctx),
  );
}

export function createNfseQueryHandler(
  invoiceRepo: Pick<IInvoiceRepository, 'findByAccessKeyAndTenantId'>,
) {
  return async function nfseQueryHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    access_key: string;
    status: string;
    nfse_number: string | null;
    authorized_at: string | null;
    last_error: string | null;
  }> {
    const params = plainToInstance(
      NfseQueryInput,
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

    // Invoice exposes getters for status/nfseNumber but not for
    // authorizedAt/lastErrorMessage — read those from the snapshot.
    const snapshot = invoice.toSnapshot();
    return {
      access_key: params.access_key,
      status: invoice.status,
      nfse_number: invoice.nfseNumber?.toString() ?? null,
      authorized_at: snapshot.authorizedAt?.toISOString() ?? null,
      last_error: invoice.toJSON().lastErrorMessage ?? null,
    };
  };
}
