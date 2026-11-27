import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { AVULSO_UNIT_CENTS } from '@/modules/credits/domain/avulso';
import type { WooviConfig } from '@/infra/config/configuration.types';
import type {
  WooviChargeCustomer,
  WooviCustomer,
} from '@/infra/external/woovi/woovi.client';
import type { BillingCycle, PlanSlug } from '@/modules/plans/domain/plan';
import { WOOVI_CONFIG } from '../http/woovi-webhook.controller';
import { BillingService } from './billing.service';
import { StripePaymentsService } from './stripe-payments.service';
import { WooviPaymentsService } from './woovi-payments.service';

export type CheckoutRequest =
  | {
      kind: 'avulso';
      units: number;
      method: 'pix' | 'card';
      customer?: Partial<WooviChargeCustomer>;
    }
  | {
      kind: 'plan';
      planSlug: PlanSlug;
      cycle: BillingCycle;
      method: 'pix' | 'card';
      customer?: Partial<WooviCustomer>;
    };

/** One entry point for "buy a plan or notes, with Pix or card". */
@Injectable()
export class CheckoutRouterService {
  constructor(
    private readonly woovi: WooviPaymentsService,
    private readonly stripe: StripePaymentsService,
    private readonly billing: BillingService,
    @Inject(WOOVI_CONFIG) private readonly wooviConfig: WooviConfig,
    private readonly audit: AccountAuditRecorder,
  ) {}

  async start(tenantId: string, request: CheckoutRequest, key: string) {
    const result = await this.route(tenantId, request, key);
    // After the provider answered; never carries the code, the link or any secret.
    await this.audit.record({
      tenantId,
      environment: null,
      action: 'billing.charge_created',
      target: {
        type: 'payment',
        id: 'paymentId' in result ? (result.paymentId ?? null) : null,
      },
      metadata:
        request.kind === 'avulso'
          ? {
              method: request.method,
              kind: request.kind,
              units: request.units,
              amount_cents: request.units * AVULSO_UNIT_CENTS,
            }
          : {
              method: request.method,
              kind: request.kind,
              plan_slug: request.planSlug,
              cycle: request.cycle,
            },
    });
    return result;
  }

  private async route(tenantId: string, request: CheckoutRequest, key: string) {
    if (typeof key !== 'string' || key.trim().length === 0 || key.length > 200)
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key must contain 1 to 200 characters',
      });
    // Plans change at renewal (no mid-period switch between providers, no double billing).
    if (
      request.kind === 'plan' &&
      (await this.billing.hasLiveEntitlement(tenantId))
    )
      throw new ConflictException({
        code: 'PLAN_ALREADY_ACTIVE',
        message:
          'A paid plan is already active. Change it at renewal, or buy single invoices.',
      });
    if (request.method === 'pix') {
      if (!this.wooviConfig.enabled)
        throw new ServiceUnavailableException({
          code: 'PIX_UNAVAILABLE',
          message: 'Pix payments are not enabled',
        });
      return request.kind === 'avulso'
        ? this.woovi.startAvulso(tenantId, request.units, key, request.customer)
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
