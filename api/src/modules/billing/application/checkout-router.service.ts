import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { WooviConfig } from '@/infra/config/configuration.types';
import type { WooviCustomer } from '@/infra/external/woovi/woovi.client';
import type { BillingCycle, PlanSlug } from '@/modules/plans/domain/plan';
import { WOOVI_CONFIG } from '../http/woovi-webhook.controller';
import { BillingService } from './billing.service';
import { StripePaymentsService } from './stripe-payments.service';
import { WooviPaymentsService } from './woovi-payments.service';

export type CheckoutRequest =
  | { kind: 'avulso'; units: number; method: 'pix' | 'card' }
  | {
      kind: 'plan';
      planSlug: PlanSlug;
      cycle: BillingCycle;
      method: 'pix' | 'card';
      customer?: WooviCustomer;
    };

/** One entry point for "buy a plan or notes, with Pix or card". */
@Injectable()
export class CheckoutRouterService {
  constructor(
    private readonly woovi: WooviPaymentsService,
    private readonly stripe: StripePaymentsService,
    private readonly billing: BillingService,
    @Inject(WOOVI_CONFIG) private readonly wooviConfig: WooviConfig,
  ) {}

  async start(tenantId: string, request: CheckoutRequest, key: string) {
    if (request.method === 'pix') {
      if (!this.wooviConfig.enabled)
        throw new ServiceUnavailableException('Pix payments are not enabled');
      return request.kind === 'avulso'
        ? this.woovi.startAvulso(tenantId, request.units, key)
        : this.woovi.startPlan(
            tenantId,
            request.planSlug,
            request.cycle,
            key,
            request.customer,
          );
    }
    if (request.kind === 'avulso')
      return this.stripe.start(
        tenantId,
        { kind: 'avulso', units: request.units },
        key,
      );
    if (request.cycle === 'annual')
      return this.stripe.start(
        tenantId,
        { kind: 'plan', planSlug: request.planSlug, cycle: 'annual' },
        key,
      );
    const session = await this.billing.checkout(
      tenantId,
      request.planSlug,
      key,
    );
    return { method: 'card' as const, url: session.url };
  }
}
