import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { IOutboxRepository } from '../domain/outbox.repository';
import type {
  NewOutboxMessage,
  OutboxMessage,
  OutboxStatus,
} from '../domain/outbox-message';
import { InvoiceOrmEntity } from './invoice.orm-entity';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

interface OutboxRow {
  id: string;
  tenant_id: string;
  environment: string;
  type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
  status: string;
  available_at: Date;
  lease_until: Date | null;
  attempts: number;
  last_error: string | null;
}

@Injectable()
export class TypeOrmOutboxRepository implements IOutboxRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private table(): string {
    const metadata = this.dataSource.getMetadata(OutboxMessageOrmEntity);
    const escape = (identifier: string) =>
      this.dataSource.driver.escape(identifier);
    return metadata.schema
      ? `${escape(metadata.schema)}.${escape(metadata.tableName)}`
      : escape(metadata.tableName);
  }

  /** UPDATE ... RETURNING resolves to [rows, affected]; INSERT ... RETURNING to rows. */
  private rowsOf(raw: unknown): OutboxRow[] {
    const list = raw as unknown[];
    return (Array.isArray(list[0]) ? list[0] : list) as OutboxRow[];
  }

  async oldestPendingAvailableAt(now: Date): Promise<Date | null> {
    const rows = await this.dataSource.query<{ oldest: Date | null }[]>(
      `SELECT MIN(available_at) AS oldest FROM ${this.table()} WHERE status = 'pending' AND available_at <= $1`,
      [now],
    );
    return rows[0]?.oldest ?? null;
  }

  async insert(message: NewOutboxMessage): Promise<boolean> {
    const raw: unknown = await this.manager().query(
      `INSERT INTO ${this.table()} (tenant_id, environment, type, aggregate_id, payload, dedupe_key, available_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [
        message.tenantId,
        message.environment,
        message.type,
        message.aggregateId,
        JSON.stringify(message.payload),
        message.dedupeKey,
        message.availableAt ?? new Date(),
      ],
    );
    return this.rowsOf(raw).length > 0;
  }

  /**
   * Production never waits for test: `live` messages are claimed first, `test` ones only get what
   * is left of the batch. A flood of test messages can neither fill the batch nor delay a live one,
   * and still moves (at least one per round, at most a fifth of the batch) so it never starves.
   * The caller dispatches the result in order, so live messages also run first.
   */
  async claimBatch(
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<OutboxMessage[]> {
    const live = await this.claimEnvironment('live', now, limit, leaseUntil);
    const testCap = Math.max(1, Math.floor(limit / 5));
    const testLimit = Math.min(testCap, Math.max(limit - live.length, 1));
    const test = await this.claimEnvironment(
      'test',
      now,
      testLimit,
      leaseUntil,
    );
    return [...live, ...test];
  }

  private async claimEnvironment(
    environment: ExecutionEnvironment,
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<OutboxMessage[]> {
    const raw: unknown = await this.dataSource.query(
      `WITH due AS (
         SELECT id FROM ${this.table()}
         WHERE environment = $4
           AND ((status = 'pending' AND available_at <= $1)
             OR (status = 'claimed' AND lease_until < $1))
         ORDER BY available_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${this.table()} m
       SET status = 'claimed', lease_until = $3, attempts = m.attempts + 1, updated_at = $1
       FROM due WHERE m.id = due.id
       RETURNING m.*`,
      [now, limit, leaseUntil, environment],
    );
    return this.rowsOf(raw).map((row) => this.toDomain(row));
  }

  async complete(
    id: string,
    tenantId: string,
    at: Date,
    attempt: number,
  ): Promise<boolean> {
    const raw: unknown = await this.manager().query(
      `UPDATE ${this.table()} SET status = 'completed', completed_at = $3, lease_until = NULL, updated_at = $3
       WHERE id = $1 AND tenant_id = $2 AND status = 'claimed' AND attempts = $4 RETURNING id`,
      [id, tenantId, at, attempt],
    );
    return this.rowsOf(raw).length > 0;
  }

  async release(
    id: string,
    tenantId: string,
    error: string,
    nextAvailableAt: Date,
    at: Date,
    attempt: number,
  ): Promise<boolean> {
    const raw: unknown = await this.manager().query(
      `UPDATE ${this.table()} SET status = 'pending', last_error = $3, available_at = $4, lease_until = NULL, updated_at = $5
       WHERE id = $1 AND tenant_id = $2 AND status = 'claimed' AND attempts = $6 RETURNING id`,
      [id, tenantId, error, nextAvailableAt, at, attempt],
    );
    return this.rowsOf(raw).length > 0;
  }

  async reviveStalledInvoices(
    tenantId: string,
    createdBefore: Date,
    limit: number,
  ): Promise<number> {
    const invoices = this.dataSource.driver.escape(
      this.dataSource.getMetadata(InvoiceOrmEntity).tableName,
    );
    const schema = this.dataSource.getMetadata(InvoiceOrmEntity).schema;
    const invoiceTable = schema
      ? `${this.dataSource.driver.escape(schema)}.${invoices}`
      : invoices;
    const raw: unknown = await this.manager().query(
      `WITH stalled AS (
         SELECT i.id FROM ${invoiceTable} i
         WHERE i.tenant_id = $1 AND i.status = 'queued' AND i.created_at < $2
           AND NOT EXISTS (
             SELECT 1 FROM ${this.table()} p
             WHERE p.tenant_id = $1 AND p.aggregate_id = i.id AND p.status IN ('pending','claimed'))
         ORDER BY i.created_at
         LIMIT $3
       )
       UPDATE ${this.table()} m
       SET status = 'pending', attempts = 0, available_at = now(), lease_until = NULL,
           completed_at = NULL, updated_at = now()
       FROM stalled
       WHERE m.tenant_id = $1 AND m.aggregate_id = stalled.id
         AND m.type IN ('invoice.calculate-taxes', 'invoice.emit')
         AND m.status IN ('completed', 'dead') AND m.updated_at < $2
       RETURNING m.aggregate_id`,
      [tenantId, createdBefore, limit],
    );
    return new Set(this.rowsOf(raw).map((row) => row.aggregate_id)).size;
  }

  async markDead(
    id: string,
    tenantId: string,
    error: string,
    at: Date,
    attempt: number,
  ): Promise<boolean> {
    const raw: unknown = await this.manager().query(
      `UPDATE ${this.table()} SET status = 'dead', last_error = $3, lease_until = NULL, updated_at = $4
       WHERE id = $1 AND tenant_id = $2 AND status = 'claimed' AND attempts = $5 RETURNING id`,
      [id, tenantId, error, at, attempt],
    );
    return this.rowsOf(raw).length > 0;
  }

  private toDomain(row: OutboxRow): OutboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      environment: row.environment as ExecutionEnvironment,
      type: row.type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      dedupeKey: row.dedupe_key,
      status: row.status as OutboxStatus,
      availableAt: row.available_at,
      leaseUntil: row.lease_until,
      attempts: row.attempts,
      lastError: row.last_error,
    };
  }
}
