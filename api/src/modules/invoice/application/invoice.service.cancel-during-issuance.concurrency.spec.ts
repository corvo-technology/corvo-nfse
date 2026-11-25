import { AsyncLocalStorage } from 'node:async_hooks';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Invoice } from '../domain/invoice';
import { DEFAULT_CANCELLATION_DESCRIPTION } from '../domain/cancellation-reason';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { InvoiceEvent } from '../domain/invoice-event';
import { InvoiceMapper } from '../infra/invoice.mapper';
import { TypeOrmInvoiceRepository } from '../infra/typeorm-invoice.repository';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { InvoiceService } from './invoice.service';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';

const tenantId = '11111111-1111-4111-8111-111111111111';
const T0 = new Date('2026-10-14T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const fiscalA = {
  reason: 'issue_error' as const,
  description: 'Valor do serviço informado incorretamente',
};
const fiscalB = {
  reason: 'other' as const,
  description: 'Tomador desistiu do contrato antes da execução',
};

type Row = Record<string, unknown>;
type Gate = { reached: Promise<void>; open: () => void };

function gate(): Gate & { arrive: () => void; wait: Promise<void> } {
  let arrive!: () => void;
  let open!: () => void;
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { reached, open, arrive, wait };
}

/** Lets every pending promise chain run until it blocks or settles. */
async function drain(): Promise<void> {
  for (let i = 0; i < 25; i += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Deterministic simulation of an invoice being cancelled while the worker issues it.
 *
 * The REAL TypeOrmInvoiceRepository (read, save, registerCancellationIntent),
 * InvoiceLifecycleService.transition and InvoiceService.cancel run over a fake
 * query builder backed by one stored row that behaves like Postgres here:
 * - `UPDATE ... SET` writes only the defined columns (TypeORM skips undefined),
 *   so `preserveCancellationRequest` really leaves the request columns alone;
 * - the WHERE predicates the repository uses are evaluated against the row
 *   (`status = 'processing'`, `cancellation_requested_at IS NULL`, ...);
 * - a transaction (UnitOfWorkPort.execute) buffers its column writes and
 *   commits them at the end; the per-tenant advisory lock is a mutex around it;
 * - `SELECT ... FOR UPDATE` (setLock) and any UPDATE take the row lock until
 *   commit; an autocommit UPDATE from outside (registerCancellationIntent)
 *   waits for it and then re-evaluates its WHERE on the committed row
 *   (READ COMMITTED).
 */
function harness(initial: InvoiceStatus, environment: ExecutionEnvironment) {
  const mapper = new InvoiceMapper();
  const created = Invoice.create(
    {
      companyId: '22222222-2222-4222-8222-222222222222',
      environment,
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
  const id = created.id;
  let committed: Row = {
    ...(mapper.toPersistence(
      Invoice.reconstitute({ ...created.toSnapshot(), status: initial }),
    ) as unknown as Row),
  };

  type Tx = {
    writes: Row[];
    events: InvoiceEvent[];
    outbox: { type: string; dedupeKey?: string }[];
    walletInserts: Row[];
  };
  const als = new AsyncLocalStorage<Tx>();
  const events: InvoiceEvent[] = [];
  const outboxMessages: { type: string; dedupeKey?: string }[] = [];
  const walletInserts: Row[] = [];
  /** Every row state ever written (committed or not), in order. */
  const history: Row[] = [];
  let intentWrites = 0;

  let lock: { owner: Tx; released: Promise<void>; release: () => void } | null =
    null;
  const acquire = async (tx: Tx) => {
    while (lock && lock.owner !== tx) await lock.released;
    if (lock) return;
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    lock = { owner: tx, released, release };
  };
  const waitUnlocked = async () => {
    while (lock) await lock.released;
  };

  const view = (tx?: Tx): Row =>
    (tx?.writes ?? []).reduce<Row>((row, write) => ({ ...row, ...write }), {
      ...committed,
    });

  const plainReadGates: ReturnType<typeof gate>[] = [];
  let plainReadsToHold = 0;
  let plainReadsHeld = 0;
  let txReadGate: ReturnType<typeof gate> | null = null;

  const matches = (row: Row, clause: unknown, params: Row): boolean => {
    if (typeof clause === 'object' && clause !== null)
      return Object.entries(clause).every(([key, value]) => row[key] === value);
    switch (clause) {
      case 'invoice.id = :id AND invoice.tenant_id = :tenantId':
      case 'id = :id AND tenant_id = :tenantId':
        return row.id === params.id && row.tenantId === params.tenantId;
      case 'invoice.environment = :environment':
        return row.environment === params.environment;
      case "status = 'processing'":
        return row.status === 'processing';
      case 'cancellation_requested_at IS NULL':
        return row.cancellationRequestedAt == null;
      default:
        throw new Error(`Unmodelled predicate: ${String(clause)}`);
    }
  };

  const createQueryBuilder = () => {
    const where: { clause: unknown; params: Row }[] = [];
    let values: Row | null = null;
    let forUpdate = false;
    const qb = {
      update: () => qb,
      set: (set: Row) => {
        // TypeORM leaves undefined values out of the SET.
        values = Object.fromEntries(
          Object.entries(set).filter(([, value]) => value !== undefined),
        );
        return qb;
      },
      where: (clause: unknown, params: Row = {}) => {
        where.push({ clause, params });
        return qb;
      },
      andWhere: (clause: unknown, params: Row = {}) => {
        where.push({ clause, params });
        return qb;
      },
      setLock: (mode: string) => {
        if (mode !== 'pessimistic_write') throw new Error(mode);
        forUpdate = true;
        return qb;
      },
      getOne: async () => {
        const tx = als.getStore();
        if (forUpdate) {
          if (!tx) throw new Error('FOR UPDATE outside a transaction');
          await acquire(tx);
        }
        const row = view(tx);
        const found = where.every((w) => matches(row, w.clause, w.params))
          ? { ...row }
          : null;
        if (tx && txReadGate) {
          const g = txReadGate;
          txReadGate = null;
          g.arrive();
          await g.wait;
        }
        if (!forUpdate && plainReadsToHold > 0) {
          plainReadsToHold -= 1;
          const g = plainReadGates[plainReadsHeld];
          plainReadsHeld += 1;
          g.arrive();
          await g.wait;
        }
        return found;
      },
      execute: async () => {
        if (!values) throw new Error('Only UPDATE is modelled');
        const tx = als.getStore();
        if (tx) {
          await acquire(tx);
          const row = view(tx);
          if (!where.every((w) => matches(row, w.clause, w.params)))
            return { affected: 0 };
          tx.writes.push(values);
          history.push(view(tx));
          return { affected: 1 };
        }
        // Autocommit UPDATE: blocks on the row lock, then re-checks its WHERE.
        await waitUnlocked();
        if (!where.every((w) => matches(committed, w.clause, w.params)))
          return { affected: 0 };
        committed = { ...committed, ...values };
        history.push({ ...committed });
        if ('cancellationRequestedAt' in values && !('status' in values))
          intentWrites += 1;
        return { affected: 1 };
      },
    };
    return qb;
  };

  const repository = new TypeOrmInvoiceRepository({
    repository: () => ({
      createQueryBuilder,
      insert: () => {
        throw new Error('unexpected insert');
      },
    }),
  } as never);

  // The per-tenant advisory lock + transaction, emulated by a promise-chain mutex.
  let tail: Promise<void> = Promise.resolve();
  const unitOfWork = {
    execute: jest.fn(async <T>(work: () => Promise<T>): Promise<T> => {
      const previous = tail;
      let done!: () => void;
      tail = new Promise<void>((resolve) => (done = resolve));
      await previous;
      const tx: Tx = { writes: [], events: [], outbox: [], walletInserts: [] };
      try {
        const result = await als.run(tx, work);
        committed = view(tx); // COMMIT
        events.push(...tx.events);
        outboxMessages.push(...tx.outbox);
        walletInserts.push(...tx.walletInserts);
        return result;
      } finally {
        if (lock?.owner === tx) {
          const held = lock;
          lock = null;
          held.release();
        }
        done();
      }
    }),
  };
  const current = () => als.getStore() as Tx;
  const billing = {
    locked: jest.fn(async <T>(_tenantId: string, work: () => Promise<T>) =>
      work(),
    ),
  };
  const eventRepo = {
    save: jest.fn(async (event: InvoiceEvent) => {
      current().events.push(event);
    }),
  };
  const credits = {
    findByReservedInvoiceId: jest
      .fn()
      .mockResolvedValue({ id: 'res-1', amount: -1 }),
    save: jest.fn(async (value: Row) => {
      current().walletInserts.push(value);
    }),
    confirm: jest.fn(async () => undefined),
  };
  const usage = { reserve: jest.fn(), settle: jest.fn() };
  const outbox = {
    enqueue: jest.fn(async (message: { type: string; dedupeKey?: string }) => {
      current().outbox.push(message);
      return true;
    }),
  };
  const lifecycle = new InvoiceLifecycleService(
    unitOfWork as never,
    { delete: jest.fn() } as never,
    usage as never,
    billing as never,
    outbox as never,
    repository,
    eventRepo as never,
    credits as never,
  );
  const webhooks = { publish: jest.fn() };
  const service = new InvoiceService(
    repository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle,
    {} as never,
    {} as never,
    webhooks as never,
    { isSimulated: (environment: string) => environment !== 'live' } as never,
    new FakeAccountAudit(),
  );

  const load = async () =>
    (await repository.findByIdAndTenantId(
      id,
      tenantId,
      environment,
    )) as Invoice;

  return {
    row: () => committed,
    history,
    events,
    outboxMessages,
    walletInserts,
    usage,
    credits,
    webhooks,
    intentWrites: () => intentWrites,
    /** The worker's in-memory copy, as loaded now. */
    load,
    cancel: (input: object) =>
      service.cancel(id, tenantId, environment, input as never),
    /** The worker persists one emission outcome with its (possibly old) copy. */
    workerMoves: async (copy: Invoice, to: InvoiceStatus) => {
      if (to === 'authorized') copy.setAuthorized('a'.repeat(50), 42);
      if (to === 'rejected') copy.setRejected('E0001', 'Rejeitada');
      const event = copy.transitionTo(to);
      return lifecycle.transition(copy, event);
    },
    /** The next `n` plain reads read the row, then wait until `open()`. */
    holdPlainReads: (n: number): Gate[] => {
      const gates = Array.from({ length: n }, () => gate());
      plainReadGates.push(...gates);
      plainReadsToHold += n;
      return gates;
    },
    /** The next read inside a transaction (transition's stored read) reads, then waits for `open()`. */
    holdTransactionRead: (): Gate => {
      txReadGate = gate();
      return txReadGate;
    },
  };
}

const intentOf = (row: Record<string, unknown>) => ({
  code: row.cancellationReason,
  description: row.cancellationDescription,
  requestedAt: row.cancellationRequestedAt,
});

describe('InvoiceService.cancel — cancelling while the invoice is being issued', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: T0,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('(a) applies an intent registered while the worker, holding an old copy, authorizes', async () => {
    const h = harness('processing', 'live');
    const workerCopy = await h.load(); // before the request: no intent
    jest.setSystemTime(at(1));
    const pending = await h.cancel(fiscalA);
    expect(pending.status).toBe('processing');
    expect(pending.hasPendingCancellation).toBe(true);
    expect(workerCopy.cancellationRequestedAt).toBeNull();

    jest.setSystemTime(at(2));
    await expect(h.workerMoves(workerCopy, 'authorized')).resolves.toBe(true);

    expect(h.row().status).toBe('cancelling');
    expect(h.row().authorizedAt).toEqual(at(2));
    // The intent was never lost, not even in an intermediate write.
    for (const state of h.history)
      expect(intentOf(state)).toEqual({
        code: 'issue_error',
        description: fiscalA.description,
        requestedAt: at(1),
      });
    expect(
      h.events.map((e) => [e.toSnapshot().fromStatus, e.toSnapshot().toStatus]),
    ).toEqual([
      ['processing', 'authorized'],
      ['authorized', 'cancelling'],
    ]);
    expect(h.outboxMessages).toEqual([
      expect.objectContaining({
        type: 'invoice.cancel',
        dedupeKey: `cancellation:${h.events[1].id}`,
      }),
    ]);
    // Credit consumed once (authorization), nothing refunded.
    expect(h.usage.settle).toHaveBeenCalledTimes(1);
    expect(h.credits.confirm).toHaveBeenCalledTimes(1);
    expect(h.walletInserts).toEqual([]);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
    const after = await h.cancel(fiscalB);
    expect(after.status).toBe('cancelling');
    expect(h.outboxMessages).toHaveLength(1);
  });

  it('(a) a request arriving between the worker’s locked read and its write waits and cancels the authorized invoice', async () => {
    const h = harness('processing', 'test');
    const workerCopy = await h.load();
    const workerRead = h.holdTransactionRead();
    jest.setSystemTime(at(1));
    const worker = h.workerMoves(workerCopy, 'authorized');
    await workerRead.reached; // the worker read the row (no intent) under FOR UPDATE

    const request = h.cancel(fiscalA);
    await drain(); // the request's UPDATE runs now, inside the worker's window
    expect(h.row().cancellationRequestedAt).toBeNull();

    workerRead.open();
    await expect(worker).resolves.toBe(true);
    const answered = await request;

    expect(answered.status).toBe('cancelling');
    expect(h.row().status).toBe('cancelling');
    expect(h.row().cancellationReason).toBe('issue_error');
    expect(h.row().cancellationDescription).toBe(fiscalA.description);
    expect(h.intentWrites()).toBe(0);
    expect(h.outboxMessages).toEqual([
      expect.objectContaining({ type: 'invoice.cancel' }),
    ]);
    expect(h.events).toHaveLength(2);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
  });

  it('(b) two simultaneous requests while processing: one intent write, same answer, second reason ignored', async () => {
    const h = harness('processing', 'live');
    const [readA, readB] = h.holdPlainReads(2);
    const first = h.cancel(fiscalA);
    const second = h.cancel(fiscalB);
    await Promise.all([readA.reached, readB.reached]); // both saw no intent
    readA.open();
    readB.open();
    const [a, b] = await Promise.all([first, second]);

    expect(h.intentWrites()).toBe(1);
    const stored = {
      code: 'issue_error',
      description: fiscalA.description,
      requestedAt: T0,
    };
    expect(intentOf(h.row())).toEqual(stored);
    for (const answer of [a, b]) {
      expect(answer.status).toBe('processing');
      expect(answer.hasPendingCancellation).toBe(true);
      expect(answer.cancellationReason).toEqual({
        code: stored.code,
        description: stored.description,
      });
      expect(answer.cancellationRequestedAt).toEqual(stored.requestedAt);
    }
    expect(h.events).toEqual([]);
    expect(h.outboxMessages).toEqual([]);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
  });

  it.each([
    ['rejected', 'an old copy', false],
    ['rejected', 'a copy holding the intent', true],
    ['failed', 'an old copy', false],
    ['failed', 'a copy holding the intent', true],
  ] as const)(
    '(c) emission %s with a pending intent (worker with %s) clears the request and refunds',
    async (outcome, _label, reloadAfterIntent) => {
      const h = harness('processing', 'live');
      let workerCopy = await h.load();
      jest.setSystemTime(at(1));
      await h.cancel(fiscalA);
      if (reloadAfterIntent) {
        workerCopy = await h.load();
        expect(workerCopy.hasPendingCancellation).toBe(true);
      }

      jest.setSystemTime(at(2));
      await expect(h.workerMoves(workerCopy, outcome)).resolves.toBe(true);

      expect(h.row().status).toBe(outcome);
      expect(intentOf(h.row())).toEqual({
        code: null,
        description: null,
        requestedAt: null,
      });
      expect(h.walletInserts).toEqual([
        expect.objectContaining({
          amount: 1,
          type: 'invoice_rejected',
          relatedTransactionId: 'res-1',
        }),
      ]);
      expect(h.usage.settle).toHaveBeenCalledWith(
        expect.any(String),
        tenantId,
        outcome,
      );
      expect(h.events).toHaveLength(1);
      expect(h.events[0].toSnapshot().reason).toMatch(
        /pending cancellation request discarded/i,
      );
      expect(h.outboxMessages).toEqual([]);
      expect(h.webhooks.publish).not.toHaveBeenCalled();
    },
  );

  it('(d) a queued cancel that loses the race to the worker registers the default text, without a cancelled webhook', async () => {
    const h = harness('queued', 'live');
    const workerCopy = await h.load();
    const [read] = h.holdPlainReads(1);
    const request = h.cancel({ reason: 'other' }); // no description
    await read.reached; // the request saw `queued`
    jest.setSystemTime(at(1));
    await expect(h.workerMoves(workerCopy, 'processing')).resolves.toBe(true);
    read.open();
    jest.setSystemTime(at(2));
    const answered = await request;

    const expected = {
      code: 'other',
      description: DEFAULT_CANCELLATION_DESCRIPTION.other,
      requestedAt: at(2),
    };
    expect(answered.status).toBe('processing');
    expect(answered.hasPendingCancellation).toBe(true);
    expect(intentOf(h.row())).toEqual(expected);
    expect(h.intentWrites()).toBe(1);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
    expect(h.walletInserts).toEqual([]);
    expect(h.events).toHaveLength(1); // only queued → processing

    // The worker, still holding its copy, then authorizes: the intent applies.
    jest.setSystemTime(at(3));
    await expect(h.workerMoves(workerCopy, 'authorized')).resolves.toBe(true);
    expect(h.row().status).toBe('cancelling');
    expect(intentOf(h.row())).toEqual(expected);
    expect(h.outboxMessages).toEqual([
      expect.objectContaining({ type: 'invoice.cancel' }),
    ]);
    expect(h.webhooks.publish).not.toHaveBeenCalled();
  });

  it('(e) a pending intent survives retry_pending and is applied when the emission is authorized', async () => {
    const h = harness('processing', 'live');
    const workerCopy = await h.load(); // old copy, reused for the whole emission
    jest.setSystemTime(at(1));
    await h.cancel(fiscalA);
    const intent = {
      code: 'issue_error',
      description: fiscalA.description,
      requestedAt: at(1),
    };

    jest.setSystemTime(at(2));
    await expect(h.workerMoves(workerCopy, 'retry_pending')).resolves.toBe(
      true,
    );
    expect(h.row().status).toBe('retry_pending');
    expect(intentOf(h.row())).toEqual(intent);
    expect((await h.load()).hasPendingCancellation).toBe(true);

    jest.setSystemTime(at(3));
    await expect(h.workerMoves(workerCopy, 'processing')).resolves.toBe(true);
    expect(intentOf(h.row())).toEqual(intent);

    jest.setSystemTime(at(4));
    await expect(h.workerMoves(workerCopy, 'authorized')).resolves.toBe(true);

    expect(h.row().status).toBe('cancelling');
    for (const state of h.history) expect(intentOf(state)).toEqual(intent);
    expect(h.outboxMessages).toEqual([
      expect.objectContaining({ type: 'invoice.cancel' }),
    ]);
    expect(h.events.map((e) => e.toSnapshot().toStatus)).toEqual([
      'retry_pending',
      'processing',
      'authorized',
      'cancelling',
    ]);
    expect(h.credits.confirm).toHaveBeenCalledTimes(1);
    expect(h.walletInserts).toEqual([]);
  });
});
