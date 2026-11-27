import { randomUUID } from 'node:crypto';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';

import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
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
  type WooviChargeCustomer,
  type WooviCustomer,
} from '@/infra/external/woovi/woovi.client';

const CHARGE_TTL_SECONDS = 24 * 60 * 60;

export interface PixSubscriptionState {
  status: 'pending' | 'active';
  planSlug: string;
  brCode: string | null;
  paymentLinkUrl: string | null;
  /** The waiting payment, so its screen can follow it. */
  paymentId?: string;
}

export interface PaymentStatusView {
  id: string;
  /** `paid` also covers an authorized Pix Automático contract. */
  status: 'pending' | 'paid' | 'expired' | 'failed';
  kind: 'plan' | 'avulso';
  units: number | null;
  plan_slug: string | null;
  paid_at: string | null;
}

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
    @Optional() private readonly eventBus?: ApplicationEventBus,
  ) {}

  async startAvulso(
    tenantId: string,
    units: number,
    idempotencyKey: string,
    customer?: Partial<WooviChargeCustomer>,
  ): Promise<PixCheckout> {
    try {
      assertAvulsoUnits(units);
    } catch (error) {
      throw new BadRequestException({
        code: 'CHECKOUT_INVALID',
        message: (error as Error).message,
      });
    }
    const buyer = this.assertBuyer(customer);
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
      customer: buyer,
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
    customer: Partial<WooviCustomer> | undefined,
  ): Promise<PixCheckout> {
    const quote = this.pricing.calculateQuote(planSlug, cycle);
    if (cycle === 'monthly') this.assertPayer(customer);
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
    await this.retirePendingContracts(tenantId);
    const sub = await this.client.createSubscription({
      correlationID: ref,
      customerCorrelationID: tenantId,
      planName: `Corvo ${quote.name}`,
      valueCents: quote.chargeTotalCents,
      comment: `Corvo ${quote.name} (mensal)`,
      customer: customer as WooviCustomer,
    });
    return this.save({
      ...base,
      checkout: {
        method: 'pix',
        brCode: sub.brCode,
        qrCodeImage: null,
        paymentLinkUrl: sub.paymentLinkUrl,
        expiresAt: null,
        providerId: sub.providerId,
      },
    });
  }

  /**
   * The charge must name its buyer (name and CPF/CNPJ), otherwise the sale reaches the invoicing
   * integration without a tax id and no note can be issued to them.
   */
  private assertBuyer(
    customer: Partial<WooviChargeCustomer> | undefined,
  ): WooviChargeCustomer {
    const name = customer?.name?.trim();
    const taxID = (customer?.taxID ?? '').replace(/\D/g, '');
    const email = customer?.email?.trim();
    if (!name)
      throw new BadRequestException({
        code: 'PIX_PAYER_FIELD_REQUIRED',
        message: 'The Pix charge needs the buyer name',
      });
    if (taxID.length !== 11 && taxID.length !== 14)
      throw new BadRequestException({
        code: 'PIX_PAYER_FIELD_REQUIRED',
        message: 'The Pix charge needs the buyer CPF or CNPJ',
      });
    return { name, taxID, ...(email ? { email } : {}) };
  }

  /** A recurring Pix needs the payer's basics: Woovi rejects the contract without them. */
  private assertPayer(
    customer: Partial<WooviCustomer> | undefined,
  ): asserts customer is WooviCustomer {
    const missing = (value: string | undefined) => !value || !value.trim();
    const field = !customer
      ? 'customer'
      : missing(customer.name)
        ? 'name'
        : missing(customer.taxID)
          ? 'taxID'
          : missing(customer.email)
            ? 'email'
            : missing(customer.phone)
              ? 'phone'
              : null;
    if (field)
      throw new BadRequestException({
        code: 'PIX_PAYER_FIELD_REQUIRED',
        message: `Pix Automático needs the payer ${field}`,
      });
  }

  async handleEvent(payload: WooviEvent): Promise<void> {
    switch (payload.event) {
      case 'OPENPIX:CHARGE_COMPLETED':
        return this.onChargeCompleted(payload);
      case 'OPENPIX:CHARGE_EXPIRED': {
        const intent = await this.byRef(payload.charge?.correlationID);
        if (intent) {
          const before = intent.status;
          await this.intents.setStatus(intent.id, 'expired', ['pending']);
          // Only the first delivery of an unpaid charge: a replay finds it already expired.
          if (before === 'pending')
            this.announce(intent.tenantId, 'pix-expired');
        }
        return;
      }
      case 'OPENPIX:SUBSCRIPTION_AUTHORIZED':
      case 'PIX_AUTOMATIC_APPROVED':
        return this.setSubscriptionStatus(payload, 'authorized', ['pending']);
      case 'OPENPIX:SUBSCRIPTION_REJECTED':
      case 'PIX_AUTOMATIC_REJECTED':
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
        const before = intent.status;
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
        if (before !== 'mismatch')
          this.announce(intent.tenantId, 'payment-mismatch');
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
    // The first paid charge is the approval: the contract is now active.
    await this.intents.setStatus(contract.id, 'authorized', ['pending']);
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
    if (!intent) return;
    const before = intent.status;
    await this.intents.setStatus(intent.id, status, onlyFrom);
    if (before === status) return; // a replay: already told
    if (status === 'rejected') this.announce(intent.tenantId, 'payment-failed');
    else if (status === 'cancelled')
      this.announce(intent.tenantId, 'subscription-canceled');
  }

  private announce(
    tenantId: string,
    kind:
      | 'pix-expired'
      | 'payment-mismatch'
      | 'payment-failed'
      | 'subscription-canceled',
  ): void {
    this.eventBus?.publishBestEffort(accountNotice(tenantId, { kind }));
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
    return intent.checkout && { ...intent.checkout, paymentId: intent.id };
  }

  /**
   * Where the tenant's Pix Automático stands: `pending` (created, waiting for the payer to authorize
   * and pay in the bank app; the QR is returned so it can be opened again) or `active`.
   */
  async pixSubscriptionState(
    tenantId: string,
  ): Promise<PixSubscriptionState | null> {
    const contracts = await this.intents.findLiveSubscriptions(tenantId);
    const active = contracts.find((c) => c.status === 'authorized');
    if (active)
      return {
        status: 'active',
        planSlug: active.planSlug!,
        brCode: null,
        paymentLinkUrl: null,
      };
    const pending = contracts[0];
    if (!pending) return null;
    return {
      status: 'pending',
      planSlug: pending.planSlug!,
      brCode: pending.checkout?.brCode ?? null,
      paymentLinkUrl: pending.checkout?.paymentLinkUrl ?? null,
      paymentId: pending.id,
    };
  }

  /** What the waiting screen asks: how this tenant's payment stands (null for an unknown or foreign id). */
  async paymentStatus(
    tenantId: string,
    id: string,
  ): Promise<PaymentStatusView | null> {
    const intent = await this.intents.findById(tenantId, id);
    if (!intent) return null;
    const status: PaymentStatusView['status'] =
      intent.status === 'paid' || intent.status === 'authorized'
        ? 'paid'
        : intent.status === 'pending'
          ? 'pending'
          : intent.status === 'expired'
            ? 'expired'
            : 'failed';
    return {
      id: intent.id,
      status,
      kind: intent.kind,
      units: intent.units,
      plan_slug: intent.planSlug,
      paid_at: intent.paidAt?.toISOString() ?? null,
    };
  }

  /** Stops future Pix Automático charges: every open contract is cancelled. The period already paid stays valid. */
  async cancelPixSubscription(tenantId: string): Promise<void> {
    const contracts = await this.intents.findLiveSubscriptions(tenantId);
    if (contracts.length === 0)
      throw new NotFoundException({
        code: 'PIX_SUBSCRIPTION_NOT_FOUND',
        message: 'No Pix Automático subscription to cancel',
      });
    for (const contract of contracts) {
      await this.client.cancelSubscription(
        contract.checkout?.providerId ?? contract.providerRef,
      );
      await this.intents.setStatus(contract.id, 'cancelled');
    }
  }

  /** A new contract replaces one still waiting for authorization, so two never wait at once. */
  private async retirePendingContracts(tenantId: string): Promise<void> {
    for (const contract of await this.intents.findLiveSubscriptions(tenantId)) {
      if (contract.status !== 'pending') continue;
      try {
        await this.client.cancelSubscription(
          contract.checkout?.providerId ?? contract.providerRef,
        );
        await this.intents.setStatus(contract.id, 'cancelled', ['pending']);
      } catch (error) {
        // Only a courtesy: the new contract must not be blocked by it.
        this.logger.warn({
          event: 'woovi_pending_contract_not_retired',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
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
    const id = randomUUID();
    await this.intents.insert({
      ...input,
      id,
      provider: 'woovi',
      expiresAt: input.checkout?.expiresAt
        ? new Date(input.checkout.expiresAt)
        : null,
      paidAt: null,
      createdAt: new Date(),
    });
    return { ...input.checkout!, paymentId: id };
  }
}
