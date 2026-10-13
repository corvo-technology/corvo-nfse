import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import {
  instrumentTypeOrmRepository,
  observeTypeOrmTransaction,
  readActiveTypeOrmTransactionCount,
} from './typeorm-telemetry';

describe('TypeORM telemetry', () => {
  const span = {
    addEvent: jest.fn(),
    end: jest.fn(),
    recordException: jest.fn(),
    setAttribute: jest.fn(),
    setStatus: jest.fn(),
  };
  const startActiveSpan = jest.fn(
    (
      _name: string,
      _options: unknown,
      callback: (value: typeof span) => unknown,
    ) => callback(span),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('traces terminal repository operations without recording arguments', async () => {
    const findOne = jest.fn().mockResolvedValue({ id: 'appointment-1' });
    const repository = {
      metadata: { tableName: 'appointments' },
      manager: { connection: { options: { database: 'greenflow' } } },
      findOne,
    } as unknown as Repository<object>;

    const observed = instrumentTypeOrmRepository(repository);
    await expect(
      observed.findOne({ where: { id: 'secret-id' } }),
    ).resolves.toEqual({ id: 'appointment-1' });

    expect(findOne).toHaveBeenCalledWith({ where: { id: 'secret-id' } });
    expect(trace.getTracer('greenflow.typeorm')).toBeDefined();
    expect(startActiveSpan).toHaveBeenCalledWith(
      'typeorm.findOne appointments',
      expect.objectContaining({
        attributes: {
          'db.collection.name': 'appointments',
          'db.namespace': 'greenflow',
          'db.operation.name': 'findOne',
          'db.system.name': 'postgresql',
        },
      }),
      expect.any(Function),
    );
    expect(JSON.stringify(span.setAttribute.mock.calls)).not.toContain(
      'secret-id',
    );
  });

  it('keeps query builder chaining and traces only terminal execution', async () => {
    const builder = {
      where: jest.fn(),
      getMany: jest.fn().mockResolvedValue([{ id: 'row-1' }]),
    };
    builder.where.mockReturnValue(builder);
    const createQueryBuilder = jest.fn().mockReturnValue(builder);
    const repository = {
      metadata: { tableName: 'services' },
      manager: { connection: { options: {} } },
      createQueryBuilder,
    } as unknown as Repository<object>;

    const observed = instrumentTypeOrmRepository(repository);
    const query: SelectQueryBuilder<object> =
      observed.createQueryBuilder('service');
    const chained = query.where('service.tenant_id = :tenantId', {
      tenantId: 'secret-tenant',
    });
    await expect(chained.getMany()).resolves.toEqual([{ id: 'row-1' }]);

    expect(chained).toBe(query);
    expect(builder.where).toHaveBeenCalledTimes(1);
    expect(startActiveSpan).toHaveBeenCalledWith(
      'typeorm.getMany services',
      expect.any(Object),
      expect.any(Function),
    );
    expect(JSON.stringify(span.setAttribute.mock.calls)).not.toContain(
      'secret-tenant',
    );
  });

  it('records and rethrows repository failures unchanged', async () => {
    const failure = new Error('database unavailable');
    const repository = {
      metadata: { tableName: 'clients' },
      manager: { connection: { options: {} } },
      save: jest.fn().mockRejectedValue(failure),
    } as unknown as Repository<object>;

    await expect(instrumentTypeOrmRepository(repository).save({})).rejects.toBe(
      failure,
    );

    expect(span.recordException).toHaveBeenCalledWith(failure);
    expect(span.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: SpanStatusCode.ERROR }),
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('observes a transaction and exposes commit as a span event', async () => {
    await expect(
      observeTypeOrmTransaction(async (transaction) => {
        transaction.committed();
        return 'ok';
      }),
    ).resolves.toBe('ok');

    expect(span.addEvent).toHaveBeenCalledWith('typeorm.transaction.commit');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'greenflow.typeorm.transaction.result',
      'committed',
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('tracks overlapping transactions and always returns active state to zero', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const secondGate = new Promise<void>(
      (resolve) => (releaseSecond = resolve),
    );

    const first = observeTypeOrmTransaction(() => firstGate);
    expect(readActiveTypeOrmTransactionCount()).toBe(1);
    const second = observeTypeOrmTransaction(() => secondGate);
    expect(readActiveTypeOrmTransactionCount()).toBe(2);

    releaseSecond();
    await second;
    expect(readActiveTypeOrmTransactionCount()).toBe(1);
    releaseFirst();
    await first;
    expect(readActiveTypeOrmTransactionCount()).toBe(0);
  });

  it('decrements active transactions when the operation fails', async () => {
    await expect(
      observeTypeOrmTransaction(() => {
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');

    expect(readActiveTypeOrmTransactionCount()).toBe(0);
  });
});
