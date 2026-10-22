import { INVOICE_CALCULATE_TAXES } from '../domain/invoice-message-types';
import { OutboxService } from './outbox.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { BillingRepository } from '@/modules/billing/domain/billing.repository';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { creditsUsageChanged } from '@/modules/billing/application/credits-usage.events';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import type { CachePort } from '@/infra/redis/cache.port';
import { ICreditTransactionRepository } from '@/modules/credits/domain/credit-transaction.repository';
import { Invoice } from '../domain/invoice';
import type { CancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { NewOutboxMessage } from '../domain/outbox-message';
import { InvoiceEvent } from '../domain/invoice-event';
import {
  EMISSION_IN_PROGRESS_STATUSES,
  type InvoiceStatus,
} from '../domain/invoice-status';
import { cancellationMessage } from './invoice-cancel.handler';
import {
  INVOICE_REPOSITORY,
  INVOICE_EVENT_REPOSITORY,
  type IInvoiceRepository,
  type IInvoiceEventRepository,
} from '../domain/invoice.repository';

/** Statuses that release an unused live reservation. */
const REFUND_STATUSES = ['rejected', 'failed', 'cancelled'];
/** Origins of an already authorized invoice: its credit is final and billing is untouched. */
const FISCALLY_AUTHORIZED_ORIGINS: (InvoiceStatus | null)[] = [
  'authorized',
  'cancelling',
];
/** Emission outcomes that will never be authorized: a pending cancellation request is moot. */
const DISCARDS_CANCELLATION_REQUEST: InvoiceStatus[] = ['rejected', 'failed'];

/** One transaction for fiscal state, audit event and the corresponding credit. */
@Injectable()
export class InvoiceLifecycleService {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    private readonly usage: BillingUsageService,
    private readonly billing: BillingRepository,
    private readonly outbox: OutboxService,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    @Inject(INVOICE_EVENT_REPOSITORY)
    private readonly events: IInvoiceEventRepository,
    private readonly credits: ICreditTransactionRepository,
    @Optional() private readonly eventBus?: ApplicationEventBus,
  ) {}

  async submit(
    invoice: Invoice,
    event: InvoiceEvent,
    _dailyLimit: number | null,
  ): Promise<void> {
    return runWithTenant(invoice.tenantId, async () => {
      await this.unitOfWork.execute(() =>
        this.billing.locked(invoice.tenantId, async () => {
          if (event.invoiceId !== invoice.id)
            throw new Error('Invoice/event identity mismatch');
          if (
            invoice.idempotencyKey &&
            (await this.invoices.findByIdempotencyKey(
              invoice.idempotencyKey,
              invoice.tenantId,
              invoice.environment,
            ))
          )
            throw Object.assign(new Error('Idempotency key exists'), {
              code: '23505',
            });
          if (invoice.environment === 'live') {
            const periodId = await this.usage.reserve(invoice.tenantId);
            await this.credits.save(
              {
                tenantId: invoice.tenantId,
                amount: -1,
                type: 'invoice_authorized',
                reservedInvoiceId: invoice.id,
                periodId,
                isReservation: true,
                description: `Reservation for invoice ${invoice.id}`,
                createdAt: new Date(),
              },
              invoice.tenantId,
            );
          }
          await this.invoices.insert(invoice, invoice.tenantId);
          await this.events.save(event, invoice.tenantId);
          await this.outbox.enqueue({
            tenantId: invoice.tenantId,
            environment: invoice.environment,
            type: INVOICE_CALCULATE_TAXES,
            aggregateId: invoice.id,
            payload: {
              invoiceId: invoice.id,
              companyId: invoice.companyId,
              tenantId: invoice.tenantId,
            },
            dedupeKey: `calc:${invoice.id}`,
            availableAt: invoice.scheduledFor ?? undefined,
          });
        }),
      );
      if (invoice.environment === 'live') {
        await this.cache.delete(`credit:balance:${invoice.tenantId}`);
        // After the reservation committed; a failing listener never affects emission.
        this.eventBus?.publishBestEffort(creditsUsageChanged(invoice.tenantId));
      }
    });
  }

  async transition(
    invoice: Invoice,
    event: InvoiceEvent,
    message?: NewOutboxMessage,
  ): Promise<boolean> {
    return runWithTenant(invoice.tenantId, async () => {
      const applied = await this.unitOfWork.execute(() =>
        this.billing.locked(invoice.tenantId, async () => {
          if (event.invoiceId !== invoice.id)
            throw new Error('Invoice/event identity mismatch');
          // FOR UPDATE: a concurrent registerCancellationIntent waits for this
          // commit and then no longer matches, instead of landing unseen.
          const stored = await this.invoices.findByIdAndTenantId(
            invoice.id,
            invoice.tenantId,
            invoice.environment,
            { forUpdate: true },
          );
          if (!stored) throw new Error('Invoice not found');
          if (stored.status === invoice.status) return false;
          const fromStatus = event.toSnapshot().fromStatus;
          if (stored.status !== fromStatus)
            throw new ConcurrentInvoiceTransitionError(invoice.id);
          // The worker's copy may predate a cancellation intent registered by
          // the API: during emission the stored row is the only source of truth.
          const duringEmission =
            fromStatus !== null &&
            EMISSION_IN_PROGRESS_STATUSES.includes(fromStatus);
          let recorded = event;
          if (
            duringEmission &&
            DISCARDS_CANCELLATION_REQUEST.includes(invoice.status)
          ) {
            if (stored.cancellationRequestedAt)
              recorded = withCancellationDiscarded(event);
            invoice.discardPendingCancellation();
            // No preserve: this destination clears the columns on purpose.
            await this.invoices.save(invoice, invoice.tenantId);
          } else {
            await this.invoices.save(invoice, invoice.tenantId, {
              preserveCancellationRequest: duringEmission,
            });
          }
          await this.events.save(recorded, invoice.tenantId);
          if (message) await this.outbox.enqueue(message);
          await this.settleCredit(invoice, fromStatus);
          const pending = stored.cancellationReason;
          if (
            duringEmission &&
            invoice.status === 'authorized' &&
            stored.cancellationRequestedAt &&
            pending
          )
            await this.applyPendingCancellation(invoice, pending);
          return true;
        }),
      );
      if (invoice.environment === 'live')
        await this.cache.delete(`credit:balance:${invoice.tenantId}`);
      return applied;
    });
  }

  /**
   * authorized → cancelling inside the authorization's transaction, with the
   * reason read from the stored row. The request keeps its stored columns
   * (including the original request time); no credit effect (origin authorized).
   */
  private async applyPendingCancellation(
    invoice: Invoice,
    reason: CancellationReason,
  ): Promise<void> {
    const event = invoice.requestCancellation(reason);
    await this.invoices.save(invoice, invoice.tenantId, {
      preserveCancellationRequest: true,
    });
    await this.events.save(event, invoice.tenantId);
    await this.outbox.enqueue(cancellationMessage(invoice, event));
  }

  private async settleCredit(
    invoice: Invoice,
    fromStatus: InvoiceStatus | null,
  ): Promise<void> {
    if (invoice.environment !== 'live') return;
    if (FISCALLY_AUTHORIZED_ORIGINS.includes(fromStatus)) return;
    await this.usage.settle(invoice.id, invoice.tenantId, invoice.status);
    const reservation = await this.credits.findByReservedInvoiceId(
      invoice.id,
      invoice.tenantId,
    );
    if (!reservation) return;
    if (invoice.status === 'authorized')
      await this.credits.confirm(reservation.id, invoice.tenantId);
    if (REFUND_STATUSES.includes(invoice.status)) {
      await this.credits.save(
        {
          tenantId: invoice.tenantId,
          amount: -reservation.amount,
          type: 'invoice_rejected',
          relatedTransactionId: reservation.id,
          isReservation: false,
          description: `Refund for invoice ${invoice.id}`,
          createdAt: new Date(),
        },
        invoice.tenantId,
      );
      await this.credits.confirm(reservation.id, invoice.tenantId);
    }
  }
}

/** Same event (id and time), with the audit note that the request was dropped. */
function withCancellationDiscarded(event: InvoiceEvent): InvoiceEvent {
  const snapshot = event.toSnapshot();
  return InvoiceEvent.reconstitute({
    ...snapshot,
    reason: snapshot.reason
      ? `${snapshot.reason} (pending cancellation request discarded)`
      : 'Pending cancellation request discarded',
  });
}
