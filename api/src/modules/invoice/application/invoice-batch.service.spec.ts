import { InvoiceBatchService } from './invoice-batch.service';
import { IdempotencyConflictError } from '../domain/errors';
import type { AuthContext } from '@/modules/auth/auth-context';

const auth = { executionEnvironment: 'test' } as AuthContext;
const tenantId = 'tenant-1';
const valid = (extra: Record<string, unknown> = {}) => ({
  companyTaxId: '11222333000181',
  service: { description: 'Servico' },
  amount: 10,
  competenceDate: '2026-01-01',
  ...extra,
});
const ready = (id: string) => ({
  kind: 'ready' as const,
  invoice: { id } as never,
  event: {} as never,
  requestHash: `hash-${id}`,
});

describe('InvoiceBatchService.emitBatch', () => {
  let invoices: { prepareEmission: jest.Mock };
  let lifecycle: { submitBatch: jest.Mock };
  let service: InvoiceBatchService;

  beforeEach(() => {
    let n = 0;
    invoices = {
      prepareEmission: jest.fn(async () => ready(`inv-${n++}`)),
    };
    lifecycle = {
      submitBatch: jest.fn(async (_t: string, entries: unknown[]) =>
        entries.map(() => ({ ok: true })),
      ),
    };
    service = new InvoiceBatchService(invoices as never, lifecycle as never);
  });

  it('rejects an item that fails DTO validation and still submits the others', async () => {
    const result = await service.emitBatch(
      [valid(), { companyTaxId: '11222333000181' }, valid()],
      tenantId,
      auth,
    );
    expect(result).toMatchObject({ total: 3, accepted: 2, rejected: 1 });
    expect(result.results[1]).toMatchObject({
      index: 1,
      status: 'rejected',
      error: { code: 'ERROR_VALIDATION' },
    });
    expect(
      (lifecycle.submitBatch.mock.calls as unknown[][])[0]?.[1],
    ).toHaveLength(2);
  });

  it.each(['SCHEDULE', 'RECURRING'])(
    'rejects an item with options.type %s: schedules are created one at a time with POST /invoices',
    async (type) => {
      const result = await service.emitBatch(
        [
          valid(),
          valid({
            options: { type, recurrence: { frequency: 'WEEKLY' } },
            competenceDate: '2026-11-09',
          }),
        ],
        tenantId,
        auth,
      );
      expect(result).toMatchObject({ accepted: 1, rejected: 1 });
      expect(result.results[1]).toMatchObject({
        status: 'rejected',
        error: { code: 'ERROR_VALIDATION' },
      });
      expect(invoices.prepareEmission).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects items that are not objects', async () => {
    const result = await service.emitBatch(
      [null, 'text', valid()],
      tenantId,
      auth,
    );
    expect(result.results.map((r) => r.status)).toEqual([
      'rejected',
      'rejected',
      'accepted',
    ]);
  });

  it('maps each prepared item back to its original index', async () => {
    invoices.prepareEmission.mockImplementation(
      async (dto: { amount: number }) => ready(`inv-amount-${dto.amount}`),
    );
    const result = await service.emitBatch(
      [valid({ amount: 1 }), { nope: true }, valid({ amount: 3 })],
      tenantId,
      auth,
    );
    expect(result.results).toEqual([
      { index: 0, status: 'accepted', invoice: { id: 'inv-amount-1' } },
      expect.objectContaining({ index: 1, status: 'rejected' }),
      { index: 2, status: 'accepted', invoice: { id: 'inv-amount-3' } },
    ]);
  });

  it('passes idempotencyKey separately and strips it from the dto', async () => {
    await service.emitBatch(
      [valid({ idempotencyKey: 'row-1' })],
      tenantId,
      auth,
    );
    const [dto, tenant, ctx, key] = invoices.prepareEmission.mock.calls[0];
    expect(dto).not.toHaveProperty('idempotencyKey');
    expect([tenant, ctx, key]).toEqual([tenantId, auth, 'row-1']);
  });

  it('returns replayed items as accepted with replayed true and does not submit them', async () => {
    invoices.prepareEmission.mockResolvedValueOnce({
      kind: 'replay',
      invoice: { id: 'old' },
    });
    const result = await service.emitBatch([valid()], tenantId, auth);
    expect(result.results[0]).toEqual({
      index: 0,
      status: 'accepted',
      replayed: true,
      invoice: { id: 'old' },
    });
    expect(result.accepted).toBe(1);
    expect(lifecycle.submitBatch).not.toHaveBeenCalled();
  });

  it('rejects the second occurrence of an idempotencyKey inside the batch', async () => {
    const result = await service.emitBatch(
      [valid({ idempotencyKey: 'dup' }), valid({ idempotencyKey: 'dup' })],
      tenantId,
      auth,
    );
    expect(result.results[0]?.status).toBe('accepted');
    expect(result.results[1]).toMatchObject({
      status: 'rejected',
      error: { code: 'ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH' },
    });
    expect(invoices.prepareEmission).toHaveBeenCalledTimes(1);
  });

  it('merges submitBatch rejections (e.g. monthly limit) into the results', async () => {
    lifecycle.submitBatch.mockResolvedValue([
      { ok: true },
      { ok: false, code: 'ERROR_MONTHLY_LIMIT_EXCEEDED', message: 'limit' },
    ]);
    const result = await service.emitBatch([valid(), valid()], tenantId, auth);
    expect(result).toMatchObject({ total: 2, accepted: 1, rejected: 1 });
    expect(result.results[1]).toEqual({
      index: 1,
      status: 'rejected',
      error: { code: 'ERROR_MONTHLY_LIMIT_EXCEEDED', message: 'limit' },
    });
  });

  it('passes the request hash to submitBatch and maps a replay found inside the lock', async () => {
    lifecycle.submitBatch.mockResolvedValue([
      { ok: true, replayed: { id: 'winner' } },
    ]);
    const result = await service.emitBatch([valid()], tenantId, auth);
    expect((lifecycle.submitBatch.mock.calls as unknown[][])[0]?.[1]).toEqual([
      expect.objectContaining({ requestHash: 'hash-inv-0' }),
    ]);
    expect(result.results[0]).toEqual({
      index: 0,
      status: 'accepted',
      replayed: true,
      invoice: { id: 'winner' },
    });
  });

  it('does not call submitBatch when every item is rejected', async () => {
    const result = await service.emitBatch([{}, {}], tenantId, auth);
    expect(result).toMatchObject({ total: 2, accepted: 0, rejected: 2 });
    expect(lifecycle.submitBatch).not.toHaveBeenCalled();
  });

  it('turns prepareEmission domain errors into item rejections', async () => {
    invoices.prepareEmission.mockRejectedValueOnce(
      new IdempotencyConflictError('k'),
    );
    const result = await service.emitBatch([valid(), valid()], tenantId, auth);
    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      error: { code: 'ERROR_IDEMPOTENCY_CONFLICT' },
    });
    expect(result.accepted).toBe(1);
  });

  it('prepares at most 5 items concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    invoices.prepareEmission.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return ready(`inv-${Math.random()}`);
    });
    await service.emitBatch(
      Array.from({ length: 12 }, () => valid()),
      tenantId,
      auth,
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('rethrows unexpected errors without submitting anything', async () => {
    invoices.prepareEmission.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.emitBatch([valid(), valid()], tenantId, auth),
    ).rejects.toThrow('boom');
    expect(lifecycle.submitBatch).not.toHaveBeenCalled();
  });

  describe('checkItem', () => {
    it('says ok for a valid item and saves nothing', async () => {
      expect(await service.checkItem(valid(), tenantId, auth)).toEqual({
        ok: true,
      });
      expect(lifecycle.submitBatch).not.toHaveBeenCalled();
    });

    it('returns the item error instead of throwing when the item is invalid', async () => {
      const result = await service.checkItem({ amount: 'x' }, tenantId, auth);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'ERROR_VALIDATION' },
      });
    });
  });
});
