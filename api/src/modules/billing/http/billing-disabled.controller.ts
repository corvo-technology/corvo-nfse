import { All, Controller, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';

/**
 * Stands where the billing, credits and payment webhook controllers are not registered
 * (`DEPLOYMENT_MODE=self_hosted`), so those routes answer 404 `BILLING_DISABLED` instead of
 * the generic "not found" or, worse, a login prompt.
 */
@Controller(['billing', 'credits', 'webhooks/stripe', 'webhooks/woovi'])
@PublicRoute()
@ApiExcludeController()
export class BillingDisabledController {
  @All(['', '*path'])
  disabled(): never {
    throw new NotFoundException({
      code: 'BILLING_DISABLED',
      message: 'Billing is disabled in self-hosted mode',
    });
  }
}
