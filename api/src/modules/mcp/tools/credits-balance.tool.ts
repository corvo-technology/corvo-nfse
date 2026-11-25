import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import type { CreditsService } from '@/modules/credits/application/credits.service';
import { toPublicCreditTransaction } from './public-shapes';
import { invalidInput } from './tool-input-errors';

export const CREDITS_BALANCE_TOOL = {
  name: 'credits_balance',
  description:
    'Credit balance of the workspace (notes left in the plan plus avulso notes) and, optionally, the recent credit history. Use it to answer "quantas notas ainda posso emitir?" or "onde foram meus créditos?". Pass include_history=true to also get the latest credit transactions, paginated with limit and cursor. When the balance is too low, buy more with credits_purchase.',
  inputSchema: {
    type: 'object',
    properties: {
      include_history: {
        type: 'boolean',
        default: false,
        description: 'Also return recent credit transactions.',
      },
      limit: { type: 'number', default: 20, minimum: 1, maximum: 100 },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from previous response',
      },
    },
  },
} as const;

class CreditsBalanceInput {
  @IsOptional() @IsBoolean() include_history?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

export function createCreditsBalanceHandler(
  usage: Pick<BillingUsageService, 'status'>,
  credits: Pick<CreditsService, 'getHistoryPage'>,
) {
  return async function creditsBalanceHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CreditsBalanceInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);

    // Same arithmetic as GET /credits: plan notes of a lapsed plan are not usable.
    const status = await usage.status(ctx.activeTenantId);
    const planRemaining = status.blocked ? 0 : status.included_remaining;
    const result: Record<string, unknown> = {
      balance: planRemaining + status.avulsoBalance,
      plan_remaining: planRemaining,
      avulso_balance: status.avulsoBalance,
      hard_limit: status.hard_limit,
    };
    if (params.include_history === true) {
      const page = await credits.getHistoryPage(ctx.activeTenantId, {
        limit: params.limit ?? 20,
        cursor: params.cursor,
      });
      result.history = page.data.map(toPublicCreditTransaction);
      result.next_cursor = page.pagination.nextCursor;
    }
    return result;
  };
}
