import { CursorQuery } from '@/shared/http/pagination';
import { Inject, Injectable } from '@nestjs/common';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import { ICreditTransactionRepository } from '../domain/credit-transaction.repository';
import { AVULSO_UNIT_CENTS, assertAvulsoUnits } from '../domain/avulso';
import { CreditTransaction } from '../domain/credit-transaction';

const CACHE_TTL_SECONDS = 86400; // 24 hours
const CACHE_KEY_PREFIX = 'credit:balance';

@Injectable()
export class CreditsService {
  getHistoryPage(tenantId: string, options: CursorQuery) {
    return this.txRepo.listPage(tenantId, options);
  }

  constructor(
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    private readonly txRepo: ICreditTransactionRepository,
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
   * Credits paid one-off notes (R$ 0,99 each, minimum 3). `paymentRef` is the
   * provider reference of the payment (e.g. `woovi:<correlationID>`); a repeated
   * ref is a no-op, so provider webhooks can be redelivered safely.
   */
  async grantAvulso(
    tenantId: string,
    units: number,
    paymentRef: string,
  ): Promise<{ tenantId: string; balance: number; creditsGranted: number }> {
    assertAvulsoUnits(units);
    let creditsGranted = units;
    try {
      await this.txRepo.save(
        {
          tenantId,
          amount: units,
          type: 'purchase',
          source: 'avulso',
          amountBrlCents: units * AVULSO_UNIT_CENTS,
          unitPriceCentsApplied: AVULSO_UNIT_CENTS,
          stripeSessionId: paymentRef,
          description: `Notas avulsas (${units})`,
          createdAt: new Date(),
        },
        tenantId,
      );
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      creditsGranted = 0; // already credited for this payment
    }
    await this.cache.delete(this.getCacheKey(tenantId));
    return { ...(await this.getBalance(tenantId)), creditsGranted };
  }

  previewPurchase(units: number): {
    units: number;
    unitPriceCents: number;
    totalCents: number;
  } {
    assertAvulsoUnits(units);
    return {
      units,
      unitPriceCents: AVULSO_UNIT_CENTS,
      totalCents: units * AVULSO_UNIT_CENTS,
    };
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
    metadata?: Record<string, unknown>,
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
        ...(metadata ? { metadata } : {}),
        createdAt: new Date(),
      },
      tenantId,
    );
    await this.cache.delete(this.getCacheKey(tenantId));
    return this.getBalance(tenantId);
  }

  /** Drops the cached balance (e.g. after a rollback left a stale value in it). */
  async invalidateBalance(tenantId: string): Promise<void> {
    await this.cache.delete(this.getCacheKey(tenantId));
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
