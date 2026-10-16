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
import { InvoiceEvent } from '../domain/invoice-event';
import {
  INVOICE_REPOSITORY,
  INVOICE_EVENT_REPOSITORY,
  type IInvoiceRepository,
  type IInvoiceEventRepository,
} from '../domain/invoice.repository';

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

  async transition(invoice: Invoice, event: InvoiceEvent): Promise<void> {
    return runWithTenant(invoice.tenantId, async () => {
      await this.unitOfWork.execute(() =>
        this.billing.locked(invoice.tenantId, async () => {
          if (event.invoiceId !== invoice.id)
            throw new Error('Invoice/event identity mismatch');
          const stored = await this.invoices.findByIdAndTenantId(
            invoice.id,
            invoice.tenantId,
            invoice.environment,
          );
          if (!stored) throw new Error('Invoice not found');
          if (stored.status === invoice.status) return;
          if (stored.status !== event.toSnapshot().fromStatus)
            throw new Error('Concurrent invoice transition');
          await this.invoices.save(invoice, invoice.tenantId);
          await this.events.save(event, invoice.tenantId);
          if (invoice.environment !== 'live') return;
          await this.usage.settle(invoice.id, invoice.tenantId, invoice.status);
          const reservation = await this.credits.findByReservedInvoiceId(
            invoice.id,
            invoice.tenantId,
          );
          if (!reservation) return;
          if (invoice.status === 'authorized')
            await this.credits.confirm(reservation.id, invoice.tenantId);
          if (invoice.status === 'rejected' || invoice.status === 'failed') {
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
        }),
      );
      if (invoice.environment === 'live')
        await this.cache.delete(`credit:balance:${invoice.tenantId}`);
    });
  }
}
