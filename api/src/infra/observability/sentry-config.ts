import type { ErrorEvent, NodeOptions } from '@sentry/nestjs';

export type SentryEnvironment =
  | NodeJS.ProcessEnv
  | Record<string, string | undefined>;

export type ResolvedSentryConfig = {
  enabled: boolean;
  dsn?: string;
  environment: string;
  release?: string;
  errorSampleRate: number;
  debug: boolean;
  flushTimeoutMs: number;
};

export function resolveSentryConfig(
  env: SentryEnvironment,
): ResolvedSentryConfig {
  const enabled = env.SENTRY_ENABLED === 'true';

  return {
    enabled,
    dsn: enabled ? nonEmpty(env.SENTRY_DSN) : undefined,
    environment:
      nonEmpty(env.SENTRY_ENVIRONMENT) ??
      nonEmpty(env.NODE_ENV) ??
      'development',
    release: nonEmpty(env.SENTRY_RELEASE) ?? nonEmpty(env.APP_VERSION),
    errorSampleRate: boundedNumber(env.SENTRY_ERROR_SAMPLE_RATE, 1, 0, 1),
    debug: env.SENTRY_DEBUG === 'true',
    flushTimeoutMs: boundedNumber(env.SENTRY_FLUSH_TIMEOUT_MS, 2000, 1, 60_000),
  };
}

export function buildSentryOptions(config: ResolvedSentryConfig): NodeOptions {
  return {
    enabled: config.enabled,
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    sampleRate: config.errorSampleRate,
    debug: config.debug,
    skipOpenTelemetrySetup: true,
    enableLogs: false,
    includeLocalVariables: false,
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    beforeSend: sanitizeSentryEvent,
  };
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const sanitized = { ...event };
  delete sanitized.request;
  delete sanitized.user;
  delete sanitized.extra;

  if (sanitized.message)
    sanitized.message = redactSensitiveText(sanitized.message);
  if (sanitized.exception?.values) {
    sanitized.exception = {
      ...sanitized.exception,
      values: sanitized.exception.values.map((value) => ({
        ...value,
        ...(value.value ? { value: redactSensitiveText(value.value) } : {}),
      })),
    };
  }

  const safeBreadcrumbs = sanitized.breadcrumbs
    ?.filter((breadcrumb) => breadcrumb.category?.startsWith('greenflow.'))
    .map((breadcrumb) => ({
      timestamp: breadcrumb.timestamp,
      type: breadcrumb.type,
      category: breadcrumb.category,
      level: breadcrumb.level,
      data: sanitizeRecord(breadcrumb.data, SAFE_BREADCRUMB_KEYS),
    }));
  if (safeBreadcrumbs?.length) sanitized.breadcrumbs = safeBreadcrumbs;
  else delete sanitized.breadcrumbs;

  if (sanitized.contexts) {
    const { greenflow, trace } = sanitized.contexts;
    sanitized.contexts = {
      ...(greenflow
        ? { greenflow: sanitizeRecord(greenflow, SAFE_CONTEXT_KEYS) }
        : {}),
      ...(trace ? { trace } : {}),
    };
  }

  return sanitized;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(password|token|secret|api[_-]?key|authorization)(\s*[:=]\s*)[^\s,;]+/gi,
      '$1$2[REDACTED]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '[REDACTED_ID]',
    );
}

const SAFE_CONTEXT_KEYS = new Set([
  'statusCode',
  'method',
  'route',
  'requestId',
  'traceId',
  'spanId',
  'failureKind',
  'errorCode',
  'retryable',
  'module',
  'operation',
  'stage',
  'providerStatus',
  'sqlState',
  'constraint',
  'queue',
  'jobName',
  'attemptsMade',
  'maxAttempts',
]);

const SAFE_BREADCRUMB_KEYS = new Set([
  'operation',
  'stage',
  'status',
  'errorCode',
  'attempt',
]);

function sanitizeRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object') return {};
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!allowedKeys.has(key) || item === undefined) continue;
    if (typeof item === 'string') sanitized[key] = item.slice(0, 300);
    else if (
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null
    ) {
      sanitized[key] = item;
    }
  }
  return sanitized;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
