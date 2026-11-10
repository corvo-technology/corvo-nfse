import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import { ImportRepository } from '../domain/import.repository';
import { LIMIT_CODES } from '../domain/import';
import { ImportStateError } from '../domain/import-error';
import { rowKey, type ImportRef } from './import-reader.service';
import { ImportReviewService, type ImportView } from './import-review.service';
import { importAuthContext } from './system-auth-context';

export { LIMIT_CODES };
export const IMPORT_EMIT_QUEUE = 'import-emit';
export const IMPORT_EMIT_ATTEMPTS = 3;
/** Same size the batch accepts in one call. */
const CHUNK = 50;
@Injectable()
export class ImportEmitService {
  constructor(
    private readonly repo: ImportRepository,
    private readonly review: ImportReviewService,
    private readonly batch: InvoiceBatchService,
    @InjectQueue(IMPORT_EMIT_QUEUE) private readonly queue: Queue<ImportRef>,
  ) {}

  /**
   * Starts emitting. Safe to call twice: only the first call claims the import and enqueues the job.
   * From `done` it sends again only the rows the plan limit turned away.
   */
  async emit(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
    options: { sendEmail?: boolean } = {},
  ): Promise<ImportView> {
    const view = await this.review.get(tenantId, env, id);
    const markEmail = async () => {
      if (options.sendEmail)
        await this.repo.enableEmailOnQueued(tenantId, id);
    };
    if (view.status === 'emitting') {
      // Already running, or its job was lost (restart, exhausted retries): queue what is waiting and
      // enqueue under the fixed job id, which does nothing while a job for this import is alive.
      if ((await this.repo.markRowsQueued(tenantId, id, LIMIT_CODES)) > 0)
        await this.enqueue(tenantId, env, id);
      return view;
    }
    if (view.status !== 'ready' && view.status !== 'done')
      throw new ImportStateError();

    const queued = await this.repo.markRowsQueued(tenantId, id, LIMIT_CODES);
    if (queued === 0) {
      const latest = await this.review.get(tenantId, env, id);
      if (latest.status === 'emitting') return latest;
      throw new ImportStateError('There is nothing to emit in this import');
    }
    await markEmail();
    if (await this.repo.claimEmit(tenantId, id)) {
      try {
        await this.enqueue(tenantId, env, id);
      } catch (error) {
        await this.repo.updateStatus(tenantId, id, { status: view.status });
        throw error;
      }
    }
    return this.review.get(tenantId, env, id);
  }

  private enqueue(
    tenantId: string,
    environment: ExecutionEnvironment,
    importId: string,
  ) {
    return this.queue.add(
      'emit',
      { tenantId, environment, importId },
      {
        jobId: `import-emit-${importId}`,
        attempts: IMPORT_EMIT_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /** The job gave up: turn what is still queued into a retryable rejection so the import can settle. */
  async failRun(ref: ImportRef): Promise<void> {
    await this.repo.rejectQueued(ref.tenantId, ref.importId, {
      code: 'ERROR_IMPORT_EMIT_FAILED',
      message: 'The emission was interrupted. Emit again to retry these rows.',
    });
  }

  /** The job: emits queued rows one chunk at a time until none is left or the plan limit stops it. */
  async run(ref: ImportRef): Promise<void> {
    const { tenantId, environment, importId } = ref;
    const auth = importAuthContext(tenantId, environment);
    for (;;) {
      const page = await this.repo.listRows(tenantId, environment, importId, {
        status: 'queued',
        limit: CHUNK,
      });
      if (page.items.length === 0) break;
      const { results } = await this.batch.emitBatch(
        page.items.map((row) => ({
          ...row.data,
          idempotencyKey: rowKey(importId, row.line),
        })),
        tenantId,
        auth,
      );
      let limit: { code: string; message: string } | null = null;
      for (const result of results) {
        const row = page.items[result.index];
        if (!row) continue;
        if (result.status === 'accepted') {
          await this.repo.updateRow(tenantId, importId, row.line, {
            status: 'accepted',
            invoiceId: result.invoice.id,
            errorCode: null,
            errorMessage: null,
          });
          continue;
        }
        await this.repo.updateRow(tenantId, importId, row.line, {
          status: 'rejected',
          invoiceId: null,
          errorCode: result.error.code,
          errorMessage: result.error.message,
        });
        if (LIMIT_CODES.includes(result.error.code)) limit ??= result.error;
      }
      if (limit) {
        await this.repo.rejectQueued(tenantId, importId, {
          code: limit.code,
          message: limit.message,
        });
        break;
      }
    }
    // Finished sending: close the import right away when every invoice is already final.
    await this.review.get(tenantId, environment, importId);
  }
}
