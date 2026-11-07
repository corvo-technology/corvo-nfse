import * as Sentry from '@sentry/nestjs';

export type SentryRuntime =
  'api' | 'webhooks' | 'worker' | 'baileys' | 'canary';

export type UnhandledHttpContext = {
  statusCode: number;
  method?: string;
  route?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  failureKind: string;
  errorCode?: string;
  retryable?: boolean;
};

export function captureUnhandledHttpException(
  exception: Error,
  context: UnhandledHttpContext,
): string | undefined {
  return captureExceptionSafely(
    exception,
    undefined,
    context.route ?? 'unhandled_http_exception',
    {
      statusCode: context.statusCode,
      method: context.method,
      route: context.route,
      requestId: context.requestId,
      traceId: context.traceId,
      spanId: context.spanId,
      failureKind: context.failureKind,
      errorCode: context.errorCode,
      retryable: context.retryable,
    },
    {
      handled: context.failureKind === 'dependency',
      transaction: [context.method, context.route].filter(Boolean).join(' '),
      failureKind: context.failureKind,
      errorCode: context.errorCode,
      statusCode: context.statusCode,
      retryable: context.retryable,
    },
  );
}

export function captureRuntimeException(
  exception: unknown,
  runtime: SentryRuntime,
  operation: string,
): string | undefined {
  return captureExceptionSafely(
    normalizeException(exception),
    runtime,
    operation,
  );
}

export function captureTerminalWorkerException(
  exception: unknown,
  context: {
    queue: string;
    jobName?: string;
    attemptsMade: number;
    maxAttempts: number;
  },
): string | undefined {
  return captureExceptionSafely(
    normalizeException(exception),
    'worker',
    `queue.${context.queue}`,
    {
      queue: context.queue,
      jobName: context.jobName,
      attemptsMade: context.attemptsMade,
      maxAttempts: context.maxAttempts,
      failureKind: 'internal',
    },
    {
      handled: false,
      failureKind: 'internal',
      errorCode: exception instanceof Error ? exception.name : 'NonErrorThrown',
      retryable: false,
    },
  );
}

export type SentrySeverityLevel =
  'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

export function captureBaileysDisconnect(
  exception: Error,
  context: {
    tenantId: string;
    statusCode?: number;
    disconnectReason: string;
    reconnect: boolean;
    registered: boolean;
    phoneNumber?: string;
    lifecyclePhase?: string;
    level?: SentrySeverityLevel;
  },
): string | undefined {
  return captureExceptionSafely(
    exception,
    'baileys',
    'baileys.disconnect',
    {
      tenantId: context.tenantId,
      statusCode: context.statusCode,
      disconnectReason: context.disconnectReason,
      reconnect: context.reconnect,
      registered: context.registered,
      phoneNumber: context.phoneNumber,
      lifecyclePhase: context.lifecyclePhase,
      failureKind: 'internal',
    },
    {
      handled: false,
      failureKind: 'internal',
      errorCode: exception instanceof Error ? exception.name : 'NonErrorThrown',
      statusCode: context.statusCode,
      retryable: context.reconnect,
    },
    context.level ?? 'error',
  );
}

export async function flushSentry(timeoutMs = 2000): Promise<boolean> {
  if (!isSentryReady()) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

function captureExceptionSafely(
  exception: Error,
  runtime: SentryRuntime | undefined,
  operation: string,
  context?: Record<string, unknown>,
  diagnostics?: {
    handled?: boolean;
    transaction?: string;
    failureKind?: string;
    errorCode?: string;
    statusCode?: number;
    retryable?: boolean;
  },
  level: SentrySeverityLevel = 'error',
): string | undefined {
  if (!isSentryReady()) return undefined;

  try {
    return Sentry.withScope((scope) => {
      if (runtime) scope.setTag('runtime', runtime);
      scope.setTag('operation', operation);
      const moduleName = moduleFromRoute(
        typeof context?.route === 'string' ? context.route : undefined,
      );
      if (moduleName) scope.setTag('module', moduleName);
      if (diagnostics?.failureKind) {
        scope.setTag('failure_kind', diagnostics.failureKind);
      }
      if (diagnostics?.errorCode) {
        scope.setTag('error_code', diagnostics.errorCode);
      }
      if (diagnostics?.statusCode) {
        scope.setTag('http.status_code', String(diagnostics.statusCode));
      }
      if (diagnostics?.retryable !== undefined) {
        scope.setTag('retryable', String(diagnostics.retryable));
      }
      if (diagnostics?.transaction) {
        scope.setTransactionName(diagnostics.transaction);
      }
      if (diagnostics?.failureKind === 'dependency' && diagnostics.errorCode) {
        scope.setFingerprint([
          'corvo-dependency',
          operation,
          diagnostics.errorCode,
        ]);
      }
      scope.setLevel(level);
      if (context) scope.setContext('corvo', removeUndefined(context));
      return Sentry.captureException(exception, {
        mechanism: {
          handled: diagnostics?.handled ?? false,
          type: 'corvo.global_error_handler',
        },
      });
    });
  } catch {
    return undefined;
  }
}

function isSentryReady(): boolean {
  const client = Sentry.getClient();
  return Boolean(client?.getDsn() && client.getOptions().enabled !== false);
}

function normalizeException(exception: unknown): Error {
  if (exception instanceof Error) return exception;
  const error = new Error('A non-Error value was thrown');
  error.name = 'NonErrorThrown';
  return error;
}

function removeUndefined(
  values: Record<string, unknown>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined &&
        (typeof entry[1] === 'string' ||
          typeof entry[1] === 'number' ||
          typeof entry[1] === 'boolean'),
    ),
  );
}

function moduleFromRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const segments = route.split('/').filter(Boolean);
  const tenantIndex = segments.indexOf('tenant');
  return tenantIndex >= 0 ? segments[tenantIndex + 2] : segments[1];
}
