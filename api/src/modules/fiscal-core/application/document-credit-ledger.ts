import { Inject, Injectable } from '@nestjs/common';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { ICreditTransactionRepository } from '@/modules/credits/domain/credit-transaction.repository';
import {
  CREDIT_PRICE_READER,
  type CreditPriceReader,
} from '../domain/credit-price';
import type { DocumentRef } from '../domain/document-type';

/** Statuses that give an unused live reservation back. */
const REFUND_STATUSES = [
  'rejected',
  'denied',
  'discarded',
  'failed',
  'cancelled',
];
/** Origins of a document the tax authority already authorized: its credit is final. */
const FISCALLY_AUTHORIZED_ORIGINS = ['authorized', 'cancelling'];

/**
 * Credits of a fiscal document, with the same rules the NFS-e follows: reserve when the document is
 * accepted, confirm when it is authorized, give it back when it ends without authorization.
 * Cancelling an authorized document refunds nothing. Only `live` documents cost credits.
 *
 * Call it inside the caller's transaction and under `BillingRepository.locked`, like the invoice
 * lifecycle does.
 */
@Injectable()
export class DocumentCreditLedger {
  constructor(
    private readonly usage: BillingUsageService,
    private readonly credits: ICreditTransactionRepository,
    @Inject(CREDIT_PRICE_READER) private readonly prices: CreditPriceReader,
  ) {}

  /** Spends one quota note (or avulso credit) and records the debit. Throws the billing rule when none is left. */
  async reserve(ref: DocumentRef): Promise<void> {
    if (ref.environment !== 'live') return;
    const periodId = await this.usage.reserve(ref.tenantId);
    await this.credits.save(
      {
        tenantId: ref.tenantId,
        amount: -(await this.prices.priceOf(ref.type)),
        type: 'invoice_authorized',
        ...(ref.type === 'nfse'
          ? { reservedInvoiceId: ref.id }
          : { reservedNfeDocumentId: ref.id }),
        reservedDocumentType: ref.type,
        // null period = the avulso balance paid for this document.
        periodId: periodId ?? undefined,
        source: periodId === null ? 'avulso' : undefined,
        isReservation: true,
        description: `Reservation for ${ref.type} ${ref.id}`,
        createdAt: new Date(),
      },
      ref.tenantId,
    );
  }

  /** `from` is the status the document left, `to` the one it reached. */
  async settle(
    ref: DocumentRef,
    from: string | null,
    to: string,
  ): Promise<void> {
    if (ref.environment !== 'live') return;
    if (from !== null && FISCALLY_AUTHORIZED_ORIGINS.includes(from)) return;
    await this.usage.settleDocument(ref, to);
    const reservation = await this.credits.findByReservedDocument(ref);
    if (!reservation) return;
    if (to === 'authorized')
      await this.credits.confirm(reservation.id, ref.tenantId);
    if (REFUND_STATUSES.includes(to)) {
      await this.credits.save(
        {
          tenantId: ref.tenantId,
          // What was reserved, not what the price is now.
          amount: -reservation.amount,
          type: 'invoice_rejected',
          source: reservation.source,
          relatedTransactionId: reservation.id,
          isReservation: false,
          description: `Refund for ${ref.type} ${ref.id}`,
          createdAt: new Date(),
        },
        ref.tenantId,
      );
      await this.credits.confirm(reservation.id, ref.tenantId);
    }
  }
}
