import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { INVOICE_STATUSES } from '@/modules/invoice/domain/invoice-status';
import { ListInvoicesQuery } from '@/modules/invoice/http/invoice.dto';
import { NfseListInput } from '../dto/tool-input.dto';
import { toDetailedInvoice } from './public-shapes';

export const NFSE_LIST_TOOL = {
  name: 'nfse_list',
  description:
    'List NFS-e invoices for the tenant with optional status filter and cursor pagination.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: `Filter by status (${INVOICE_STATUSES.join(', ')})`,
      },
      limit: { type: 'number', default: 50, minimum: 1, maximum: 1000 },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from previous response',
      },
    },
  },
} as const;

export function createNfseListHandler(invoiceService: InvoiceService) {
  return async function nfseListHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ invoices: unknown[]; next_cursor: string | null }> {
    const params = plainToInstance(
      NfseListInput,
      rawParams as Record<string, unknown>,
    );
    const inputErrors = await validate(params);
    if (inputErrors.length > 0) {
      throw new Error(
        `Invalid input: ${inputErrors.map((e) => e.property).join(', ')}`,
      );
    }

    // Validate against the real HTTP query DTO: it enforces the InvoiceStatus
    // enum on `status` and the 1..1000 bounds on `limit`.
    const query = plainToInstance(ListInvoicesQuery, {
      limit: params.limit ?? 50,
      cursor: params.cursor,
      status: params.status,
    });
    const queryErrors = await validate(query);
    if (queryErrors.length > 0) {
      throw new Error(
        `Invalid input: ${queryErrors.map((e) => e.property).join(', ')}`,
      );
    }

    const page = await invoiceService.list(
      ctx.tenantId,
      query,
      executionEnvironment(ctx),
    );

    return {
      invoices: page.data.map(toDetailedInvoice),
      next_cursor: page.pagination.nextCursor,
    };
  };
}
