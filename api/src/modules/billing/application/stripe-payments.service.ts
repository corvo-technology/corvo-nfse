import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingProvider } from '../domain/billing-provider.port';
import { BillingRepository } from '../domain/billing.repository';
import { PaymentIntentStore } from '../domain/payment-intent';
import { PaymentFulfillmentService } from './payment-fulfillment.service';
import {
  AVULSO_UNIT_CENTS,
  assertAvulsoUnits,
} from '@/modules/credits/domain/avulso';
import { PricingService } from '@/modules/plans/application/pricing.service';
import type { BillingCycle, PlanSlug } from '@/modules/plans/domain/plan';

export type OneTimePurchase =
  | { kind: 'avulso'; units: number }
  | { kind: 'plan'; planSlug: PlanSlug; cycle: BillingCycle };

export interface CardCheckout {
  method: 'card';
  url: string;
}

/** One-time card payments: avulso notes and prepaid annual plans. Monthly plans stay Stripe subscriptions. */
@Injectable()
export class StripePaymentsService {
  constructor(
    private readonly provider: BillingProvider,
    private readonly billing: BillingRepository,
    private readonly intents: PaymentIntentStore,
    private readonly fulfillment: PaymentFulfillmentService,
    private readonly pricing: PricingService,
  ) {}

  async start(
    tenantId: string,
    purchase: OneTimePurchase,
    idempotencyKey: string,
  ): Promise<CardCheckout> {
    const replay = (await this.intents.findByKey(tenantId, idempotencyKey))
      ?.checkout;
    if (replay) return { method: 'card', url: replay.paymentLinkUrl };

    let amountCents: number;
    let name: string;
    if (purchase.kind === 'avulso') {
      try {
        assertAvulsoUnits(purchase.units);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      amountCents = purchase.units * AVULSO_UNIT_CENTS;
      name = `Corvo: ${purchase.units} notas avulsas`;
    } else {
      if (purchase.cycle !== 'annual')
        throw new BadRequestException(
          'Monthly plans are subscriptions: use the subscription checkout',
        );
      const quote = this.pricing.calculateQuote(purchase.planSlug, 'annual');
      amountCents = quote.chargeTotalCents;
      name = `Corvo ${quote.name} (anual)`;
    }

    const customerId = await this.customerId(tenantId);
    const intentId = randomUUID();
    const session = await this.provider.createPaymentCheckout(
      customerId,
      tenantId,
      { name, amountCents, intentId },
    );
    if (!session.url)
      throw new BadRequestException('Stripe did not return a payment url');
    await this.intents.insert({
      id: randomUUID(),
      tenantId,
      kind: purchase.kind,
      planSlug: purchase.kind === 'plan' ? purchase.planSlug : null,
      cycle: purchase.kind === 'plan' ? purchase.cycle : null,
      units: purchase.kind === 'avulso' ? purchase.units : null,
      amountCents,
      provider: 'stripe',
      providerRef: intentId,
      idempotencyKey,
      status: 'pending',
      expiresAt: null,
      paidAt: null,
      checkout: {
        method: 'pix',
        brCode: null,
        qrCodeImage: null,
        paymentLinkUrl: session.url,
        expiresAt: null,
      },
      createdAt: new Date(),
    });
    return { method: 'card', url: session.url };
  }

  /** True once the purchase behind this Stripe session was delivered. */
  async isPaid(intentId: string): Promise<boolean> {
    return (
      (await this.intents.findByRef('stripe', intentId))?.status === 'paid'
    );
  }

  /** Called for a verified, paid Stripe checkout session. */
  async complete(intentId: string): Promise<void> {
    const intent = await this.intents.findByRef('stripe', intentId);
    if (!intent) return;
    if (!(await this.intents.markPaid(intent.id, new Date()))) return;
    try {
      await this.fulfillment.apply(intent);
    } catch (error) {
      // Undo the mark so the redelivered event retries instead of dropping a paid order.
      await this.intents.setStatus(intent.id, 'pending', ['paid']);
      throw error;
    }
  }

  private async customerId(tenantId: string): Promise<string> {
    const state = await this.billing.billing(tenantId);
    if (state?.stripeCustomerId) return state.stripeCustomerId;
    const id = await this.provider.createCustomer(
      tenantId,
      state?.billingEmail ?? null,
    );
    await this.billing.saveBilling(tenantId, { stripeCustomerId: id });
    return id;
  }
}
