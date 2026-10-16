import { INVOICE_EMIT } from './invoice-emit.handler';
import { OutboxService } from './outbox.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import type { CachePort } from '@/infra/redis/cache.port';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { Invoice } from '../domain/invoice';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { NewOutboxMessage } from '../domain/outbox-message';
import { InvoiceEvent } from '../domain/invoice-event';
import { InvoiceMapper } from '../infra/invoice.mapper';
import { InvoiceEventMapper } from '../infra/invoice-event.mapper';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { InvoiceEventOrmEntity } from '../infra/invoice-event.orm-entity';

/** Statuses after which no fiscal retry can still need the signed pending XML. */
const SETTLED_STATUSES = ['authorized', 'rejected', 'failed', 'cancelled'];
/** Statuses that release an unused live reservation. */
const REFUND_STATUSES = ['rejected', 'failed', 'cancelled'];
/** Origins of an already authorized invoice: its credit is final and billing is untouched. */
const FISCALLY_AUTHORIZED_ORIGINS: (string | null)[] = [
  'authorized',
  'cancelling',
];

/** One transaction for fiscal state, audit event and the corresponding credit. */
@Injectable()
export class InvoiceLifecycleService {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    private readonly usage: BillingUsageService,
    private readonly context: TypeOrmTransactionContext,
    private readonly outbox: OutboxService,
  ) {}

  private async lockTenant(
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`fiscal:${tenantId}`],
      );
    });
  }

  async submit(
    invoice: Invoice,
    event: InvoiceEvent,
    _dailyLimit: number | null,
  ): Promise<void> {
    return runWithTenant(invoice.tenantId, async () => {
      await this.database.transaction(async (manager) =>
        this.context.run(manager, async () => {
          if (event.invoiceId !== invoice.id)
            throw new Error('Invoice/event identity mismatch');
          await this.lockTenant(manager, invoice.tenantId);
          if (
            invoice.idempotencyKey &&
            (await manager.getRepository(InvoiceOrmEntity).existsBy({
              tenantId: invoice.tenantId,
              environment: invoice.environment,
              idempotencyKey: invoice.idempotencyKey,
            }))
          )
            throw Object.assign(new Error('Idempotency key exists'), {
              code: '23505',
            });
          if (invoice.environment === 'live') {
            const wallet = manager.getRepository(CreditTransactionOrmEntity);
            const periodId = await this.usage.reserve(invoice.tenantId);
            await wallet.insert({
              tenantId: invoice.tenantId,
              amount: -1,
              type: 'invoice_authorized',
              reservedInvoiceId: invoice.id,
              periodId,
              isReservation: true,
              description: `Reservation for invoice ${invoice.id}`,
            });
          }
          await manager
            .getRepository(InvoiceOrmEntity)
            .insert(
              new InvoiceMapper().toPersistence(
                invoice,
              ) as QueryDeepPartialEntity<InvoiceOrmEntity>,
            );
          await manager
            .getRepository(InvoiceEventOrmEntity)
            .insert(new InvoiceEventMapper().toPersistence(event));
          await this.outbox.enqueue({
            tenantId: invoice.tenantId,
            environment: invoice.environment,
            type: INVOICE_EMIT,
            aggregateId: invoice.id,
            payload: {
              invoiceId: invoice.id,
              companyId: invoice.companyId,
              tenantId: invoice.tenantId,
            },
            dedupeKey: `emission:${invoice.id}`,
            availableAt: invoice.scheduledFor ?? undefined,
          });
        }),
      );
      if (invoice.environment === 'live')
        await this.cache.delete(`credit:balance:${invoice.tenantId}`);
    });
  }

  async transition(
    invoice: Invoice,
    event: InvoiceEvent,
    message?: NewOutboxMessage,
  ): Promise<boolean> {
    return runWithTenant(invoice.tenantId, async () => {
      const applied = await this.database.transaction(async (manager) =>
        this.context.run(manager, async () => {
          if (event.invoiceId !== invoice.id)
            throw new Error('Invoice/event identity mismatch');
          await this.lockTenant(manager, invoice.tenantId);
          const stored = await manager
            .getRepository(InvoiceOrmEntity)
            .findOneByOrFail({
              id: invoice.id,
              tenantId: invoice.tenantId,
              environment: invoice.environment,
            });
          if (stored.status === invoice.status) return false;
          if (stored.status !== event.toSnapshot().fromStatus)
            throw new ConcurrentInvoiceTransitionError(invoice.id);
          const record = new InvoiceMapper().toPersistence(invoice);
          if (SETTLED_STATUSES.includes(invoice.status))
            record.pendingEmission = null;
          await persistTenantEntity(
            manager.getRepository(InvoiceOrmEntity),
            record,
            invoice.tenantId,
            ['companyId', 'environment'],
          );
          await manager
            .getRepository(InvoiceEventOrmEntity)
            .insert(new InvoiceEventMapper().toPersistence(event));
          if (message) await this.outbox.enqueue(message);
          if (invoice.environment !== 'live') return true;
          if (
            FISCALLY_AUTHORIZED_ORIGINS.includes(event.toSnapshot().fromStatus)
          )
            return true;
          await this.usage.settle(invoice.id, invoice.tenantId, invoice.status);
          const wallet = manager.getRepository(CreditTransactionOrmEntity);
          const reservation = await wallet.findOneBy({
            tenantId: invoice.tenantId,
            reservedInvoiceId: invoice.id,
            isReservation: true,
          });
          if (!reservation) return true;
          if (invoice.status === 'authorized')
            await wallet.update(
              { id: reservation.id, tenantId: invoice.tenantId },
              { isReservation: false },
            );
          if (REFUND_STATUSES.includes(invoice.status)) {
            await wallet.insert({
              tenantId: invoice.tenantId,
              amount: -reservation.amount,
              type: 'invoice_rejected',
              relatedTransactionId: reservation.id,
              isReservation: false,
              description: `Refund for invoice ${invoice.id}`,
            });
            await wallet.update(
              { id: reservation.id, tenantId: invoice.tenantId },
              { isReservation: false },
            );
          }
          return true;
        }),
      );
      if (invoice.environment === 'live')
        await this.cache.delete(`credit:balance:${invoice.tenantId}`);
      return applied;
    });
  }
}
