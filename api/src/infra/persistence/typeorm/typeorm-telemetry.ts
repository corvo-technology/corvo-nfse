import {
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import {
  TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
  TYPEORM_TRANSACTION_DURATION_BOUNDARIES_SECONDS,
  durationHistogramOptions,
} from '@/shared/observability/duration-histogram';

const TRACER_NAME = 'greenflow.typeorm';
const METER_NAME = 'greenflow.typeorm';

const repositoryOperations = new Set([
  'average',
  'clear',
  'count',
  'countBy',
  'decrement',
  'delete',
  'deleteAll',
  'exists',
  'existsBy',
  'find',
  'findAndCount',
  'findAndCountBy',
  'findBy',
  'findByIds',
  'findOne',
  'findOneBy',
  'findOneByOrFail',
  'findOneOrFail',
  'increment',
  'insert',
  'maximum',
  'minimum',
  'preload',
  'query',
  'recover',
  'remove',
  'restore',
  'save',
  'softDelete',
  'softRemove',
  'sum',
  'update',
  'updateAll',
  'upsert',
]);

const queryBuilderTerminalOperations = new Set([
  'execute',
  'getCount',
  'getExists',
  'getMany',
  'getManyAndCount',
  'getOne',
  'getOneOrFail',
  'getRawAndEntities',
  'getRawMany',
  'getRawOne',
  'stream',
]);

const repositoryProxies = new WeakMap<object, object>();
const operationDuration = metrics
  .getMeter(METER_NAME)
  .createHistogram(
    'greenflow.typeorm.operation.duration',
    durationHistogramOptions(
      'Duration of TypeORM entity and query-builder operations',
      TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
    ),
  );
const transactionDuration = metrics
  .getMeter(METER_NAME)
  .createHistogram(
    'greenflow.typeorm.transaction.duration',
    durationHistogramOptions(
      'Duration of application-managed TypeORM transactions',
      TYPEORM_TRANSACTION_DURATION_BOUNDARIES_SECONDS,
    ),
  );
const meter = metrics.getMeter(METER_NAME);
let activeTransactionCount = 0;
const activeTransactions = meter.createObservableGauge(
  'greenflow.typeorm.transaction.active',
  {
    description: 'Number of active application-managed TypeORM transactions',
    unit: '{transaction}',
  },
);
const startedTransactions = meter.createCounter(
  'greenflow.typeorm.transaction.started',
  {
    description: 'Number of application-managed TypeORM transactions started',
    unit: '{transaction}',
  },
);

activeTransactions.addCallback((result) => {
  result.observe(activeTransactionCount);
});

export type TypeOrmTransactionObservation = {
  committed(): void;
  rolledBack(): void;
  rollbackFailed(error: unknown): void;
};

/**
 * Adds entity-level spans above the lower-level `pg` spans while preserving
 * TypeORM's Repository and QueryBuilder APIs. Query text and arguments are
 * deliberately never inspected.
 */
export function instrumentTypeOrmRepository<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
): Repository<Entity> {
  const existing = repositoryProxies.get(repository);
  if (existing) return existing as Repository<Entity>;

  const attributes = repositoryAttributes(repository);
  const proxy = createFluentProxy(
    repository,
    repositoryOperations,
    attributes,
    (property, result) =>
      property === 'createQueryBuilder' && isObject(result)
        ? instrumentQueryBuilder(
            result as SelectQueryBuilder<Entity>,
            attributes,
          )
        : result,
  );
  repositoryProxies.set(repository, proxy);
  return proxy;
}

export function observeTypeOrmTransaction<T>(
  operation: (transaction: TypeOrmTransactionObservation) => T | Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    'typeorm.transaction',
    {
      kind: SpanKind.CLIENT,
      attributes: { 'db.system.name': 'postgresql' },
    },
    async (span) => {
      const startedAt = performance.now();
      let result = 'failed';
      activeTransactionCount += 1;
      startedTransactions.add(1);
      const observation: TypeOrmTransactionObservation = {
        committed: () => {
          result = 'committed';
          span.addEvent('typeorm.transaction.commit');
          span.setAttribute(
            'greenflow.typeorm.transaction.result',
            'committed',
          );
        },
        rolledBack: () => {
          result = 'rolled_back';
          span.addEvent('typeorm.transaction.rollback');
          span.setAttribute(
            'greenflow.typeorm.transaction.result',
            'rolled_back',
          );
        },
        rollbackFailed: (error) => {
          span.addEvent('typeorm.transaction.rollback_failed', {
            'error.type': errorType(error),
          });
        },
      };

      try {
        return await operation(observation);
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        const metricAttributes = { status: result };
        transactionDuration.record(elapsedSeconds(startedAt), metricAttributes);
        activeTransactionCount = Math.max(activeTransactionCount - 1, 0);
        span.end();
      }
    },
  );
}

export function readActiveTypeOrmTransactionCount(): number {
  return activeTransactionCount;
}

function instrumentQueryBuilder<Entity extends ObjectLiteral>(
  builder: SelectQueryBuilder<Entity>,
  attributes: Attributes,
): SelectQueryBuilder<Entity> {
  return createFluentProxy(builder, queryBuilderTerminalOperations, attributes);
}

function createFluentProxy<T extends object>(
  target: T,
  terminalOperations: ReadonlySet<string>,
  attributes: Attributes,
  mapResult: (property: string, result: unknown) => unknown = (
    _property,
    result,
  ) => result,
): T {
  const proxy = new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver);
      if (typeof value !== 'function') return value;
      const propertyName = String(property);

      return (...args: unknown[]) => {
        const invoke = () => Reflect.apply(value, current, args) as unknown;
        if (terminalOperations.has(propertyName)) {
          return observeTypeOrmOperation(propertyName, attributes, invoke);
        }
        const result = invoke();
        if (result === current) return proxy;
        return mapResult(propertyName, result);
      };
    },
  });
  return proxy;
}

function observeTypeOrmOperation<T>(
  operation: string,
  attributes: Attributes,
  invoke: () => T | Promise<T>,
): Promise<T> {
  const table = String(attributes['db.collection.name'] ?? 'unknown');
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    `typeorm.${operation} ${table}`,
    {
      kind: SpanKind.CLIENT,
      attributes: { ...attributes, 'db.operation.name': operation },
    },
    async (span) => {
      const startedAt = performance.now();
      let status = 'ok';
      try {
        return await invoke();
      } catch (error) {
        status = 'error';
        recordSpanError(span, error);
        throw error;
      } finally {
        operationDuration.record(elapsedSeconds(startedAt), {
          entity: table,
          operation,
          status,
        });
        span.end();
      }
    },
  );
}

function repositoryAttributes<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
): Attributes {
  const candidate = repository as unknown as {
    metadata?: { tableName?: unknown };
    manager?: { connection?: { options?: { database?: unknown } } };
  };
  const tableName =
    typeof candidate.metadata?.tableName === 'string'
      ? candidate.metadata.tableName
      : 'unknown';
  const database = candidate.manager?.connection?.options?.database;
  return {
    'db.system.name': 'postgresql',
    'db.collection.name': tableName,
    ...(typeof database === 'string' ? { 'db.namespace': database } : {}),
  };
}

function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setAttribute('error.type', errorType(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function elapsedSeconds(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt) / 1000;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
