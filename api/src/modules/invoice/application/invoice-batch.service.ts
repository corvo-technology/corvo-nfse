import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { validationExceptionFactory } from '@/shared/http/validation-pipe';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { recordSafely } from '@/shared/audit/record-safely';
import { Invoice } from '../domain/invoice';
import { BatchInvoiceItemDto } from '../http/invoice-batch.dto';
import { InvoiceService, type PreparedEmission } from './invoice.service';
import {
  InvoiceLifecycleService,
  type BatchSubmitEntry,
} from './invoice-lifecycle.service';
import { toBatchItemError, type BatchItemError } from './invoice-batch-error';

/** Items prepared (validated and resolved) in parallel inside one batch. */
const PREPARE_CONCURRENCY = 5;

export type BatchItemResult =
  | { index: number; status: 'accepted'; replayed?: true; invoice: Invoice }
  | { index: number; status: 'rejected'; error: BatchItemError };

export type BatchResult = {
  total: number;
  accepted: number;
  rejected: number;
  results: BatchItemResult[];
};

type Prepared = { kind: 'rejected'; error: BatchItemError } | PreparedEmission;

@Injectable()
export class InvoiceBatchService {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly audit: AccountAuditRecorder,
  ) {}

  /**
   * Validates every item on its own, then persists all the accepted ones in a
   * single transaction. An item problem never fails the batch; an unexpected
   * error does, with nothing written.
   */
  async emitBatch(
    items: unknown[],
    tenantId: string,
    authContext: AuthContext,
    options: { audit?: boolean } = {},
  ): Promise<BatchResult> {
    const duplicates = duplicateKeyIndexes(items);
    const prepared = await mapPool(items, PREPARE_CONCURRENCY, (item, index) =>
      duplicates.has(index)
        ? Promise.resolve<Prepared>({
            kind: 'rejected',
            error: {
              code: 'ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH',
              message:
                'The idempotencyKey was already used by an earlier item in this batch',
            },
          })
        : this.prepare(item, tenantId, authContext),
    );

    const entries: BatchSubmitEntry[] = [];
    const entryIndexes: number[] = [];
    prepared.forEach((item, index) => {
      if (item.kind !== 'ready') return;
      entries.push({
        invoice: item.invoice,
        event: item.event,
        requestHash: item.requestHash,
      });
      entryIndexes.push(index);
    });
    const outcomes = entries.length
      ? await this.lifecycle.submitBatch(tenantId, entries)
      : [];

    const results = prepared.map((item, index): BatchItemResult => {
      if (item.kind === 'rejected')
        return { index, status: 'rejected', error: item.error };
      if (item.kind === 'replay')
        return {
          index,
          status: 'accepted',
          replayed: true,
          invoice: item.invoice,
        };
      const outcome = outcomes[entryIndexes.indexOf(index)];
      return outcome?.ok
        ? outcome.replayed
          ? {
              index,
              status: 'accepted',
              replayed: true,
              invoice: outcome.replayed,
            }
          : { index, status: 'accepted', invoice: item.invoice }
        : {
            index,
            status: 'rejected',
            error: {
              code: outcome?.code ?? 'ERROR_INTERNAL',
              message: outcome?.message ?? 'Item was not saved',
            },
          };
    });
    const accepted = results.filter((r) => r.status === 'accepted').length;
    if (accepted > 0 && options.audit !== false)
      await recordSafely(this.audit, {
        tenantId,
        environment: executionEnvironment(authContext),
        action: 'invoice.batch_issued',
        metadata: { accepted, rejected: results.length - accepted },
      });
    return {
      total: results.length,
      accepted,
      rejected: results.length - accepted,
      results,
    };
  }

  /**
   * Validates one item exactly as the batch would, without saving anything. Used by the spreadsheet
   * import to tell the user which rows are fine before anything is emitted.
   */
  async checkItem(
    raw: unknown,
    tenantId: string,
    authContext: AuthContext,
  ): Promise<{ ok: true } | { ok: false; error: BatchItemError }> {
    const prepared = await this.prepare(raw, tenantId, authContext);
    return prepared.kind === 'rejected'
      ? { ok: false, error: prepared.error }
      : { ok: true };
  }

  private async prepare(
    raw: unknown,
    tenantId: string,
    authContext: AuthContext,
  ): Promise<Prepared> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return {
        kind: 'rejected',
        error: {
          code: 'ERROR_VALIDATION',
          message: 'Each item must be an object',
        },
      };
    try {
      const item = plainToInstance(
        BatchInvoiceItemDto,
        raw as Record<string, unknown>,
      );
      const errors = await validate(item, {
        whitelist: true,
        forbidNonWhitelisted: true,
        validationError: { target: false, value: true },
      });
      if (errors.length > 0) throw validationExceptionFactory(errors);
      // The key is not part of the invoice payload: keep the request hash identical to POST /invoices.
      const { idempotencyKey, ...dto } = item;
      if (dto.options?.type === 'SCHEDULE' || dto.options?.type === 'RECURRING')
        return {
          kind: 'rejected',
          error: {
            code: 'ERROR_VALIDATION',
            message:
              'options.type SCHEDULE and RECURRING are not supported in a batch: create a schedule with POST /v1/invoices',
          },
        };
      return await this.invoices.prepareEmission(
        dto,
        tenantId,
        authContext,
        idempotencyKey,
      );
    } catch (error) {
      const itemError = toBatchItemError(error);
      if (!itemError) throw error;
      return { kind: 'rejected', error: itemError };
    }
  }
}

function duplicateKeyIndexes(items: unknown[]): Set<number> {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  items.forEach((item, index) => {
    const key = (item as { idempotencyKey?: unknown } | null)?.idempotencyKey;
    if (typeof key !== 'string' || key === '') return;
    if (seen.has(key)) duplicates.add(index);
    else seen.add(key);
  });
  return duplicates;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
