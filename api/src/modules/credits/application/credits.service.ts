import { CursorQuery } from '@/shared/http/pagination';
import { Inject, Injectable } from '@nestjs/common';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import { ICreditTransactionRepository } from '../domain/credit-transaction.repository';
import { IPlanRepository } from '@/modules/plans/domain/plan.repository';
import { CreditTransaction, CreditSource } from '../domain/credit-transaction';

const CACHE_TTL_SECONDS = 86400; // 24 hours
const CACHE_KEY_PREFIX = 'credit:balance';

const MIN_PURCHASE_CENTS = 1000; // R$ 10

@Injectable()
export class CreditsService {
  getHistoryPage(tenantId: string, options: CursorQuery) {
    return this.txRepo.listPage(tenantId, options);
  }

  constructor(
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    private readonly txRepo: ICreditTransactionRepository,
    private readonly planRepo: IPlanRepository,
  ) {}

  private getCacheKey(tenantId: string): string {
    return `${CACHE_KEY_PREFIX}:${tenantId}`;
  }

  async getBalance(
    tenantId: string,
  ): Promise<{ tenantId: string; balance: number }> {
    const cached = await this.cache.get<{ tenantId: string; balance: number }>(
      this.getCacheKey(tenantId),
    );
    if (cached) return cached;

    const balance = await this.txRepo.calculateBalance(tenantId);
    const result = { tenantId, balance };
    await this.cache.set(this.getCacheKey(tenantId), result, {
      ttlSeconds: CACHE_TTL_SECONDS,
    });
    return result;
  }

  /**
   * Add credits to a tenant's wallet. Used by:
   *  - Stripe webhook after a successful subscription renewal (source='subscription')
   *  - Manual avulso purchase via the credit-purchase endpoint (source='avulso')
   *  - Admin tooling / grants (source='bonus')
   *
   * Pricing: `credits = floor(amountBrlCents / plan.creditUnitPriceCents)`
   * where `plan` is the tenant's CURRENT active plan.
   */
  async purchaseCredits(
    tenantId: string,
    amountBrlCents: number,
    source: CreditSource,
    description?: string,
  ): Promise<{
    tenantId: string;
    balance: number;
    creditsGranted: number;
    unitPriceCents: number;
  }> {
    if (source === 'avulso' && amountBrlCents < MIN_PURCHASE_CENTS) {
      throw new Error(
        `Minimum avulso purchase is R$ ${(MIN_PURCHASE_CENTS / 100).toFixed(2)}`,
      );
    }
    if (amountBrlCents <= 0) {
      throw new Error('amountBrlCents must be positive');
    }

    const plan = await this.planRepo.findActiveByTenantId(tenantId);
    if (!plan) {
      throw new Error('No active plan found for tenant');
    }
    const creditsGranted = Math.floor(
      amountBrlCents / plan.creditUnitPriceCents,
    );
    if (creditsGranted <= 0) {
      throw new Error(
        `Amount R$ ${(amountBrlCents / 100).toFixed(2)} below current plan minimum (1 credit = R$ ${(plan.creditUnitPriceCents / 100).toFixed(4)})`,
      );
    }

    await this.txRepo.save(
      {
        tenantId,
        amount: creditsGranted,
        type: 'purchase',
        amountBrlCents,
        unitPriceCentsApplied: plan.creditUnitPriceCents,
        planIdSnapshot: plan.id,
        source,
        description:
          description ??
          (source === 'subscription'
            ? `Plan ${plan.slug} - monthly subscription`
            : 'One-time purchase'),
        createdAt: new Date(),
      },
      tenantId,
    );
    await this.cache.delete(this.getCacheKey(tenantId));
    const balance = await this.getBalance(tenantId);
    return {
      ...balance,
      creditsGranted,
      unitPriceCents: plan.creditUnitPriceCents,
    };
  }

  /**
   * Preview how many credits a tenant would receive for an avulso purchase,
   * without actually performing the transaction. Used by the credit-purchase
   * endpoint to show the conversion in real time.
   */
  async previewPurchase(
    tenantId: string,
    amountBrlCents: number,
  ): Promise<{ credits: number; unitPriceCents: number }> {
    if (amountBrlCents <= 0) {
      throw new Error('amountBrlCents must be positive');
    }
    const plan = await this.planRepo.findActiveByTenantId(tenantId);
    if (!plan) {
      throw new Error('No active plan found for tenant');
    }
    const credits = Math.floor(amountBrlCents / plan.creditUnitPriceCents);
    return { credits, unitPriceCents: plan.creditUnitPriceCents };
  }

  /**
   * Explicitly grant a credit bonus. Used by:
   *  - Tenant signup flow
   *  - Admin tooling
   *  - Promotional campaigns
   *
   * Never call this from the message-send runtime path.
   */
  async grantBonus(
    tenantId: string,
    amount: number,
    description: string,
  ): Promise<{ tenantId: string; balance: number }> {
    if (amount === 0) {
      throw new Error('grantBonus: amount must be non-zero');
    }
    await this.txRepo.save(
      {
        tenantId,
        amount,
        type: 'bonus',
        source: 'bonus',
        description,
        createdAt: new Date(),
      },
      tenantId,
    );
    await this.cache.delete(this.getCacheKey(tenantId));
    return this.getBalance(tenantId);
  }

  async refundCredits(
    tenantId: string,
    amount: number,
    description: string,
  ): Promise<{ tenantId: string; balance: number }> {
    await this.txRepo.save(
      {
        tenantId,
        amount,
        type: 'refund',
        description,
        createdAt: new Date(),
      },
      tenantId,
    );
    await this.cache.delete(this.getCacheKey(tenantId));
    return this.getBalance(tenantId);
  }

  async getHistory(
    tenantId: string,
    offset = 0,
    limit = 50,
  ): Promise<CreditTransaction[]> {
    return this.txRepo.findByTenantId(tenantId, offset, limit);
  }

  /**
   * Reserves credits for an invoice. The reservation is a debit transaction
   * that is linked to the invoice and can be confirmed or refunded later.
   * @param tenantId The tenant ID
   * @param invoiceId The invoice ID to reserve credits for
   * @param amount The number of credits to reserve
   */
  async reserveCredit(
    tenantId: string,
    invoiceId: string,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('reserveCredit: amount must be positive');
    }
    await this.txRepo.save(
      {
        tenantId,
        amount: -amount,
        type: 'invoice_authorized',
        description: `Reserva para invoice ${invoiceId}`,
        reservedInvoiceId: invoiceId,
        isReservation: true,
        createdAt: new Date(),
      },
      tenantId,
    );
    await this.cache.delete(this.getCacheKey(tenantId));
  }

  /**
   * Confirms a reservation by converting it to a permanent debit.
   * The related reservation transaction is marked as confirmed.
   * @param invoiceId The invoice ID whose reservation should be confirmed
   */
  async confirmReservation(invoiceId: string, tenantId: string): Promise<void> {
    const reservation = await this.txRepo.findByReservedInvoiceId(
      invoiceId,
      tenantId,
    );
    if (reservation) {
      await this.txRepo.confirm(reservation.id, tenantId);
      await this.cache.delete(this.getCacheKey(reservation.tenantId));
    }
  }

  /**
   * Refunds a reservation by reversing the debit.
   * Creates a positive refund transaction linked to the original reservation.
   * @param invoiceId The invoice ID whose reservation should be refunded
   * @param amount The number of credits to refund
   */
  async refundReservation(
    invoiceId: string,
    tenantId: string,
    amount: number = 1,
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('refundReservation: amount must be positive');
    }
    const reservation = await this.txRepo.findByReservedInvoiceId(
      invoiceId,
      tenantId,
    );
    if (reservation) {
      // Create refund transaction
      await this.txRepo.save(
        {
          tenantId: reservation.tenantId,
          amount,
          type: 'invoice_rejected',
          description: `Estorno de reserva para invoice ${invoiceId}`,
          relatedTransactionId: reservation.id,
          createdAt: new Date(),
        },
        tenantId,
      );
      // Cancel the reservation
      await this.txRepo.cancelReservation(reservation.id, tenantId);
      await this.cache.delete(this.getCacheKey(reservation.tenantId));
    }
  }

  /**
   * Grants monthly allowance to a tenant at the start of a new billing period.
   * @param tenantId The tenant ID
   * @param amount The number of credits to grant
   * @param periodId Optional period identifier
   */
  async grantAllowance(
    tenantId: string,
    amount: number,
    periodId?: string,
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('grantAllowance: amount must be positive');
    }
    await this.txRepo.save(
      {
        tenantId,
        amount,
        type: 'subscription_charge',
        source: 'subscription',
        description: 'Monthly allowance',
        periodId,
        createdAt: new Date(),
      },
      tenantId,
    );
    await this.cache.delete(this.getCacheKey(tenantId));
  }
}
