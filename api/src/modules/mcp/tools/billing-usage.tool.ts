import type { AuthContext } from '@/modules/auth/auth-context';
import type { QuotaService } from '@/modules/plans/application/quota.service';

export const BILLING_USAGE_TOOL = {
  name: 'billing_usage',
  description:
    'Get the current plan quota and whether the workspace can emit another NFS-e.',
  inputSchema: { type: 'object', properties: {} },
} as const;

export function createBillingUsageHandler(quotaService: QuotaService) {
  return async function billingUsageHandler(
    _params: unknown,
    ctx: AuthContext,
  ) {
    return quotaService.getStatus(ctx.tenantId);
  };
}
