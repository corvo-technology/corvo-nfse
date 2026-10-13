import { Inject, Injectable } from '@nestjs/common';
import { TurnstileVerificationService } from '@/modules/security/application/turnstile-verification.service';
import { FreeAbuseDetectedError } from '../domain/free-abuse-detected.error';
import {
  TENANT_PLAN_REPOSITORY,
  type ITenantPlanRepository,
} from '../domain/tenant-plan-assignment';

export { FreeAbuseDetectedError };

@Injectable()
export class FreeAbuseChecker {
  constructor(
    @Inject(TENANT_PLAN_REPOSITORY)
    private readonly tenantPlans: ITenantPlanRepository,
    private readonly turnstile: TurnstileVerificationService,
  ) {}

  /** Throws FreeAbuseDetectedError if the e-mail already belongs to a free workspace. */
  async assertEmailNotInFreeWorkspace(email: string): Promise<void> {
    if (await this.tenantPlans.existsFreeTenantWithBillingEmail(email)) {
      throw new FreeAbuseDetectedError('email_already_free', { email });
    }
  }

  /** Throws FreeAbuseDetectedError if the tax id already belongs to a free workspace. */
  async assertTaxIdNotInFreeWorkspace(taxId: string): Promise<void> {
    if (await this.tenantPlans.existsFreeTenantWithBillingTaxId(taxId)) {
      throw new FreeAbuseDetectedError('tax_id_already_free', { taxId });
    }
  }

  /**
   * Verifies a Cloudflare Turnstile token.
   * @throws FreeAbuseDetectedError if verification fails
   */
  async verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
    const result = await this.turnstile.verify({ token, remoteIp });
    if (!result.success) {
      throw new FreeAbuseDetectedError('turnstile_invalid', {
        errorCodes: result.errorCodes,
      });
    }
    return true;
  }
}
