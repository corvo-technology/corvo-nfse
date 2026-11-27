import { ImportEmitService, LIMIT_CODES } from './import-emit.service';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';

const T = 't1';
const ref = { tenantId: T, environment: 'live' as const, importId: 'i1' };
const view = (status: string, counters: object = {}) => ({
  id: 'i1',
  status,
  counters,
});
const queuedRow = (line: number) => ({
  line,
  status: 'queued',
  data: { amount: line },
});

describe('ImportEmitService', () => {
  const repo = {
    claimEmit: jest.fn(),
    markRowsQueued: jest.fn(),
    rejectQueued: jest.fn(),
    listRows: jest.fn(),
    settleRows: jest.fn(),
    updateStatus: jest.fn(),
  };
  const review = { get: jest.fn() };
  const batch = { emitBatch: jest.fn() };
  const queue = { add: jest.fn() };
  const testQueue = { add: jest.fn() };
  let service: ImportEmitService;
  let audit: FakeAccountAudit;

  beforeEach(() => {
    jest.resetAllMocks();
    queue.add.mockResolvedValue(undefined);
    testQueue.add.mockResolvedValue(undefined);
    audit = new FakeAccountAudit();
    service = new ImportEmitService(
      repo as never,
      review as never,
      batch as never,
      queue as never,
      testQueue as never,
      audit,
    );
  });

  describe('audit', () => {
    const start = () => {
      review.get
        .mockResolvedValueOnce({ ...view('ready'), fileName: 'notas.csv' })
        .mockResolvedValueOnce(view('emitting'));
      repo.markRowsQueued.mockResolvedValue(3);
      repo.claimEmit.mockResolvedValue(true);
    };

    it('records import.emitted with the file name and row count', async () => {
      start();
      await service.emit(T, 'live', 'i1');
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({
        action: 'import.emitted',
        tenantId: T,
        environment: 'live',
        target: { type: 'import', id: 'i1', label: 'notas.csv' },
        metadata: { rows: 3 },
      });
    });

    it('keeps the action when the recorder fails', async () => {
      start();
      jest.spyOn(audit, 'record').mockRejectedValue(new Error('boom'));
      await expect(service.emit(T, 'live', 'i1')).resolves.toBeDefined();
    });
  });

  describe('emit', () => {
    it('queues the rows, claims the emit once and enqueues one job', async () => {
      review.get
        .mockResolvedValueOnce(view('ready'))
        .mockResolvedValueOnce(view('emitting'));
      repo.markRowsQueued.mockResolvedValue(3);
      repo.claimEmit.mockResolvedValue(true);
      const out = await service.emit(T, 'live', 'i1');
      expect(repo.markRowsQueued).toHaveBeenCalledWith(T, 'i1', LIMIT_CODES);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'emit',
        ref,
        expect.objectContaining({ attempts: 3 }),
      );
      expect(out.status).toBe('emitting');
    });

    it('a test import runs in its own queue and a live one does not', async () => {
      review.get
        .mockResolvedValueOnce(view('ready'))
        .mockResolvedValueOnce(view('emitting'));
      repo.markRowsQueued.mockResolvedValue(3);
      repo.claimEmit.mockResolvedValue(true);
      await service.emit(T, 'test', 'i1');
      expect(testQueue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('a second click while emitting with nothing queued enqueues nothing', async () => {
      review.get.mockResolvedValue(view('emitting'));
      repo.markRowsQueued.mockResolvedValue(0);
      await service.emit(T, 'live', 'i1');
      expect(queue.add).not.toHaveBeenCalled();
      expect(repo.claimEmit).not.toHaveBeenCalled();
    });

    it('a click while emitting re-enqueues under the same job id, so a lost job is recovered and a live one is not doubled', async () => {
      review.get.mockResolvedValue(view('emitting'));
      repo.markRowsQueued.mockResolvedValue(5);
      await service.emit(T, 'live', 'i1');
      expect(queue.add).toHaveBeenCalledWith(
        'emit',
        ref,
        expect.objectContaining({ jobId: 'import-emit-i1' }),
      );
      expect(repo.claimEmit).not.toHaveBeenCalled();
    });

    it('losing the claim race to another click enqueues nothing', async () => {
      review.get
        .mockResolvedValueOnce(view('ready'))
        .mockResolvedValueOnce(view('emitting'));
      repo.markRowsQueued.mockResolvedValue(3);
      repo.claimEmit.mockResolvedValue(false);
      await service.emit(T, 'live', 'i1');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('refuses to emit when nothing can be emitted', async () => {
      review.get.mockResolvedValue(view('done'));
      repo.markRowsQueued.mockResolvedValue(0);
      await expect(service.emit(T, 'live', 'i1')).rejects.toMatchObject({
        name: 'ImportStateError',
      });
      expect(repo.claimEmit).not.toHaveBeenCalled();
    });

    it('refuses an import that is still being read or failed', async () => {
      review.get.mockResolvedValue(view('processing'));
      await expect(service.emit(T, 'live', 'i1')).rejects.toMatchObject({
        name: 'ImportStateError',
      });
      review.get.mockResolvedValue(view('failed'));
      await expect(service.emit(T, 'live', 'i1')).rejects.toMatchObject({
        name: 'ImportStateError',
      });
    });

    it('undoes the claim when the job cannot be enqueued', async () => {
      review.get.mockResolvedValue(view('done'));
      repo.markRowsQueued.mockResolvedValue(2);
      repo.claimEmit.mockResolvedValue(true);
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(service.emit(T, 'live', 'i1')).rejects.toThrow('redis down');
      expect(repo.updateStatus).toHaveBeenCalledWith(T, 'i1', {
        status: 'done',
      });
    });
  });

  describe('failRun', () => {
    it('after the last attempt, rejects what is still queued with a retryable code so the import can settle', async () => {
      repo.rejectQueued.mockResolvedValue(undefined);
      await service.failRun(ref);
      expect(repo.rejectQueued).toHaveBeenCalledWith(T, 'i1', {
        code: 'ERROR_IMPORT_EMIT_FAILED',
        message: expect.any(String),
      });
      expect(LIMIT_CODES).toContain('ERROR_IMPORT_EMIT_FAILED');
    });
  });

  describe('run', () => {
    it('emits queued rows 50 at a time with a key per line and records each outcome', async () => {
      repo.listRows
        .mockResolvedValueOnce({
          items: [queuedRow(2), queuedRow(3)],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ items: [], nextCursor: null });
      batch.emitBatch.mockResolvedValue({
        results: [
          { index: 0, status: 'accepted', invoice: { id: 'inv-2' } },
          {
            index: 1,
            status: 'rejected',
            error: { code: 'ERROR_VALIDATION', message: 'bad' },
          },
        ],
      });
      review.get.mockResolvedValue(view('emitting'));
      await service.run(ref);
      expect(repo.listRows).toHaveBeenCalledWith(T, 'live', 'i1', {
        status: 'queued',
        limit: 50,
      });
      expect(batch.emitBatch).toHaveBeenCalledWith(
        [
          { amount: 2, idempotencyKey: 'import:i1:2' },
          { amount: 3, idempotencyKey: 'import:i1:3' },
        ],
        T,
        expect.objectContaining({ executionEnvironment: 'live' }),
        { audit: false },
      );
      expect(repo.settleRows).toHaveBeenCalledTimes(1);
      expect(repo.settleRows).toHaveBeenCalledWith(T, 'i1', [
        {
          line: 2,
          status: 'accepted',
          invoiceId: 'inv-2',
          errorCode: null,
          errorMessage: null,
        },
        {
          line: 3,
          status: 'rejected',
          invoiceId: null,
          errorCode: 'ERROR_VALIDATION',
          errorMessage: 'bad',
        },
      ]);
    });

    it('when the plan limit is hit mid chunk, the rest is rejected for later and the run stops', async () => {
      const items = Array.from({ length: 50 }, (_, i) => queuedRow(i + 2));
      repo.listRows.mockResolvedValueOnce({ items, nextCursor: null });
      batch.emitBatch.mockResolvedValue({
        results: items.map((_, index) =>
          index < 30
            ? { index, status: 'accepted', invoice: { id: `inv-${index}` } }
            : {
                index,
                status: 'rejected',
                error: {
                  code: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
                  message: 'Monthly processing limit reached',
                },
              },
        ),
      });
      review.get.mockResolvedValue(view('emitting'));
      await service.run(ref);
      expect(repo.settleRows).toHaveBeenCalledTimes(1);
      expect((repo.settleRows.mock.calls[0] as unknown[][])[2]).toHaveLength(
        50,
      );
      expect(repo.rejectQueued).toHaveBeenCalledWith(T, 'i1', {
        code: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
        message: 'Monthly processing limit reached',
      });
      expect(repo.listRows).toHaveBeenCalledTimes(1);
    });

    it('does not mark anything when the batch fails unexpectedly, so the job retries the same rows', async () => {
      repo.listRows.mockResolvedValueOnce({
        items: [queuedRow(2)],
        nextCursor: null,
      });
      batch.emitBatch.mockRejectedValue(new Error('db down'));
      await expect(service.run(ref)).rejects.toThrow('db down');
      expect(repo.settleRows).not.toHaveBeenCalled();
    });

    it('a replayed key (after a crash) counts as accepted', async () => {
      repo.listRows
        .mockResolvedValueOnce({ items: [queuedRow(2)], nextCursor: null })
        .mockResolvedValueOnce({ items: [], nextCursor: null });
      batch.emitBatch.mockResolvedValue({
        results: [
          {
            index: 0,
            status: 'accepted',
            replayed: true,
            invoice: { id: 'inv-2' },
          },
        ],
      });
      review.get.mockResolvedValue(view('emitting'));
      await service.run(ref);
      expect(repo.settleRows).toHaveBeenCalledWith(T, 'i1', [
        expect.objectContaining({
          line: 2,
          status: 'accepted',
          invoiceId: 'inv-2',
        }),
      ]);
    });
  });
});
