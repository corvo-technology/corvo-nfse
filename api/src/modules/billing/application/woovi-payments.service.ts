import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentIntentStore,
  type PaymentIntent,
  type PixCheckout,
} from '../domain/payment-intent';
import { assertReplayMatches, type ExpectedPurchase } from './checkout-replay';
import { PaymentFulfillmentService } from './payment-fulfillment.service';
import {
  AVULSO_UNIT_CENTS,
  assertAvulsoUnits,
} from '@/modules/credits/domain/avulso';
import { PricingService } from '@/modules/plans/application/pricing.service';
import type { BillingCycle, PlanSlug } from '@/modules/plans/domain/plan';
import {
  WooviClient,
  type WooviCustomer,
} from '@/infra/external/woovi/woovi.client';

const CHARGE_TTL_SECONDS = 24 * 60 * 60;

export interface WooviEvent {
  event?: string;
  charge?: {
    correlationID?: string;
    value?: number;
    subscription?: { correlationID?: string };
  };
  pix?: { value?: number };
  subscription?: { correlationID?: string };
}

const isDuplicate = (error: unknown) =>
  (error as { code?: string } | null)?.code === '23505';

@Injectable()
export class WooviPaymentsService {
  private readonly logger = new Logger(WooviPaymentsService.name);

  constructor(
    private readonly client: WooviClient,
    private readonly intents: PaymentIntentStore,
    private readonly fulfillment: PaymentFulfillmentService,
    private readonly pricing: PricingService,
  ) {}

  async startAvulso(
    tenantId: string,
    units: number,
    idempotencyKey: string,
  ): Promise<PixCheckout> {
    try {
      assertAvulsoUnits(units);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const replay = await this.replay(tenantId, idempotencyKey, {
      kind: 'avulso',
      planSlug: null,
      cycle: null,
      units,
    });
    if (replay) return replay;
    const amountCents = units * AVULSO_UNIT_CENTS;
    const ref = randomUUID();
    const charge = await this.client.createCharge({
      correlationID: ref,
      valueCents: amountCents,
      comment: `Corvo: ${units} notas avulsas`,
      expiresInSeconds: CHARGE_TTL_SECONDS,
    });
    return this.save({
      tenantId,
      kind: 'avulso',
      planSlug: null,
      cycle: null,
      units,
      amountCents,
      providerRef: ref,
      idempotencyKey,
      status: 'pending',
      checkout: this.pixCheckout(charge, CHARGE_TTL_SECONDS),
    });
  }

  async startPlan(
    tenantId: string,
    planSlug: PlanSlug,
    cycle: BillingCycle,
    idempotencyKey: string,
    customer: WooviCustomer | undefined,
  ): Promise<PixCheckout> {
    const quote = this.pricing.calculateQuote(planSlug, cycle);
    if (cycle === 'monthly' && !customer?.name?.trim())
      throw new BadRequestException('Pix Automático needs the customer name');
    if (cycle === 'monthly' && !customer?.taxID?.trim())
      throw new BadRequestException('Pix Automático needs the customer taxID');
    const replay = await this.replay(tenantId, idempotencyKey, {
      kind: 'plan',
      planSlug,
      cycle,
      units: null,
    });
    if (replay) return replay;
    const ref = randomUUID();
    const base = {
      tenantId,
      kind: 'plan' as const,
      planSlug,
      cycle,
      units: null,
      amountCents: quote.chargeTotalCents,
      providerRef: ref,
      idempotencyKey,
      status: 'pending' as const,
    };
    if (cycle === 'annual') {
      const charge = await this.client.createCharge({
        correlationID: ref,
        valueCents: quote.chargeTotalCents,
        comment: `Corvo ${quote.name} (anual)`,
        expiresInSeconds: CHARGE_TTL_SECONDS,
      });
      return this.save({
        ...base,
        checkout: this.pixCheckout(charge, CHARGE_TTL_SECONDS),
      });
    }
    const sub = await this.client.createSubscription({
      correlationID: ref,
      valueCents: quote.chargeTotalCents,
      comment: `Corvo ${quote.name} (mensal)`,
      customer: customer!,
    });
    return this.save({
      ...base,
      checkout: {
        method: 'pix',
        brCode: null,
        qrCodeImage: null,
        paymentLinkUrl: sub.paymentLinkUrl,
        expiresAt: null,
      },
    });
  }

  async handleEvent(payload: WooviEvent): Promise<void> {
    switch (payload.event) {
      case 'OPENPIX:CHARGE_COMPLETED':
        return this.onChargeCompleted(payload);
      case 'OPENPIX:CHARGE_EXPIRED': {
        const intent = await this.byRef(payload.charge?.correlationID);
        if (intent)
          await this.intents.setStatus(intent.id, 'expired', ['pending']);
        return;
      }
      case 'OPENPIX:SUBSCRIPTION_AUTHORIZED':
        return this.setSubscriptionStatus(payload, 'authorized', ['pending']);
      case 'OPENPIX:SUBSCRIPTION_REJECTED':
        return this.setSubscriptionStatus(payload, 'rejected');
      case 'OPENPIX:SUBSCRIPTION_CANCELLED':
        return this.setSubscriptionStatus(payload, 'cancelled');
      default:
        return;
    }
  }

  /** Never trust the webhook body alone: Woovi must say this charge is paid, for this value. */
  private async confirmedByWoovi(ref: string, expected: number) {
    const charge = await this.client.getCharge(ref);
    if (charge.status === 'COMPLETED' && charge.value === expected) return true;
    this.logger.warn({
      event: 'woovi_unconfirmed_payment',
      ref,
      status: charge.status,
    });
    return false;
  }

  /** Marks paid, delivers, and undoes the mark if delivery fails so a redelivery retries. */
  private async settle(
    intent: PaymentIntent,
    deliver: () => Promise<void>,
  ): Promise<void> {
    if (!(await this.intents.markPaid(intent.id, new Date()))) return;
    try {
      await deliver();
    } catch (error) {
      await this.intents.setStatus(intent.id, 'pending', ['paid']);
      throw error;
    }
  }

  private async onChargeCompleted(payload: WooviEvent): Promise<void> {
    const ref = payload.charge?.correlationID;
    const paid = payload.pix?.value ?? payload.charge?.value;
    if (!ref || typeof paid !== 'number') return;
    const intent = await this.byRef(ref);
    if (intent) {
      if (paid !== intent.amountCents) {
        this.logger.warn({
          event: 'woovi_amount_mismatch',
          ref,
          expected: intent.amountCents,
          paid,
        });
        await this.intents.setStatus(intent.id, 'mismatch', [
          'pending',
          'authorized',
          'expired',
        ]);
        return;
      }
      if (!(await this.confirmedByWoovi(ref, intent.amountCents))) return;
      await this.settle(intent, () => this.fulfillment.apply(intent));
      return;
    }
    const contractRef = payload.charge?.subscription?.correlationID;
    const contract = await this.byRef(contractRef);
    if (!contract || contract.kind !== 'plan' || contract.cycle !== 'monthly')
      return;
    if (paid !== contract.amountCents) {
      this.logger.warn({ event: 'woovi_cycle_amount_mismatch', ref, paid });
      return;
    }
    if (!(await this.confirmedByWoovi(ref, contract.amountCents))) return;
    // One row per cycle charge makes redelivery a no-op (unique provider_ref).
    let cycle = await this.intents.findByRef('woovi', ref);
    if (!cycle) {
      cycle = {
        ...contract,
        id: randomUUID(),
        providerRef: ref,
        idempotencyKey: null,
        status: 'pending',
        paidAt: null,
        checkout: null,
        createdAt: new Date(),
      };
      try {
        await this.intents.insert(cycle);
      } catch (error) {
        if (!isDuplicate(error)) throw error;
        return; // a concurrent delivery owns this cycle
      }
    }
    const row = cycle;
    await this.settle(row, () =>
      this.fulfillment.activatePlan(
        contract.tenantId,
        contract.planSlug!,
        'monthly',
      ),
    );
  }

  private async setSubscriptionStatus(
    payload: WooviEvent,
    status: 'authorized' | 'rejected' | 'cancelled',
    onlyFrom?: Array<'pending'>,
  ): Promise<void> {
    const intent = await this.byRef(payload.subscription?.correlationID);
    if (intent) await this.intents.setStatus(intent.id, status, onlyFrom);
  }

  private byRef(ref: string | undefined) {
    return ref ? this.intents.findByRef('woovi', ref) : Promise.resolve(null);
  }

  private async replay(
    tenantId: string,
    key: string,
    expected: Omit<ExpectedPurchase, 'provider'>,
  ) {
    const intent = await this.intents.findByKey(tenantId, key);
    if (!intent) return null;
    assertReplayMatches(intent, { provider: 'woovi', ...expected });
    return intent.checkout;
  }

  /** True while a Pix Automático contract can still charge this tenant. */
  async hasPixSubscription(tenantId: string): Promise<boolean> {
    return (await this.intents.findLiveSubscription(tenantId)) !== null;
  }

  /** Stops future Pix Automático charges. The period already paid stays valid. */
  async cancelPixSubscription(tenantId: string): Promise<void> {
    const contract = await this.intents.findLiveSubscription(tenantId);
    if (!contract)
      throw new NotFoundException('No Pix Automático subscription to cancel');
    await this.client.cancelSubscription(contract.providerRef);
    await this.intents.setStatus(contract.id, 'cancelled');
  }

  private pixCheckout(
    charge: { brCode: string; qrCodeImage: string; paymentLinkUrl: string },
    ttlSeconds: number,
  ): PixCheckout {
    return {
      method: 'pix',
      brCode: charge.brCode,
      qrCodeImage: charge.qrCodeImage,
      paymentLinkUrl: charge.paymentLinkUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  private async save(
    input: Omit<
      PaymentIntent,
      'id' | 'provider' | 'expiresAt' | 'paidAt' | 'createdAt'
    >,
  ): Promise<PixCheckout> {
    await this.intents.insert({
      ...input,
      id: randomUUID(),
      provider: 'woovi',
      expiresAt: input.checkout?.expiresAt
        ? new Date(input.checkout.expiresAt)
        : null,
      paidAt: null,
      createdAt: new Date(),
    });
    return input.checkout!;
  }
}
