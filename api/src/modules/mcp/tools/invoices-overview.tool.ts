import { plainToInstance } from 'class-transformer';
import { IsIn, IsOptional, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceOverviewService } from '@/modules/invoice/application/invoice-overview.service';
import type { OverviewPeriod } from '@/modules/invoice/domain/invoice-overview.repository';
import { invalidInput } from './tool-input-errors';

export const INVOICES_OVERVIEW_TOOL = {
  name: 'invoices_overview',
  description:
    'Dashboard summary of the workspace ("Visão geral") for the last 7 or 30 calendar days (America/Sao_Paulo, today included): how many invoices were authorized, rejected or still processing, the number of authorized notes per day, and the 5 most recent invoices. Use it to answer "como estão minhas notas?", "quantas notas emiti este mês?" or "tem alguma nota rejeitada?". It returns counts, not revenue totals: for the amount of specific notes use nfse_list or nfse_get.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['7d', '30d'],
        default: '7d',
        description: 'Window ending today: 7d (default) or 30d.',
      },
    },
  },
} as const;

class InvoicesOverviewInput {
  @IsOptional() @IsIn(['7d', '30d']) period?: OverviewPeriod;
}

export function createInvoicesOverviewHandler(
  overview: Pick<InvoiceOverviewService, 'get'>,
) {
  return async function invoicesOverviewHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      InvoicesOverviewInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const result = await overview.get(
      ctx.activeTenantId,
      executionEnvironment(ctx),
      params.period ?? '7d',
    );
    return {
      ...result,
      recentInvoices: result.recentInvoices.map((invoice) => invoice.toJSON()),
    };
  };
}
