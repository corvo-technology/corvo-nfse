import { randomUUID } from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { LoggingConfig } from '@/infra/config/configuration';

const SENSITIVE_LOG_FIELD_NAMES = [
  'password',
  'passwordChangeToken',
  'client_secret',
  'secret',
  'webhookSecret',
  'signature',
  'apiKey',
  'authorizationCode',
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'taxID',
  'taxId',
  'tax_id',
  'cpf',
  'cnpj',
  'pixKey',
  'providerResponse',
  'externalId',
  'externalChargeId',
  'accessTokenEncrypted',
  'webhookSecret',
  'verifyToken',
  // Woovi sends the webhook secret as `?authorization=` in the callback url.
  'authorization',
  'key',
  'api_key',
  'auth',
  'secret_key',
];

const SENSITIVE_LOG_HEADER_NAMES = [
  ...SENSITIVE_LOG_FIELD_NAMES.map((field) => field.toLowerCase()),
  'x-pix-key',
  'x-tax-id',
  'x-webhook-secret',
  'x-verify-token',
  'x-corvo-proxy-secret',
  'x-csrf-token',
];

export const SENSITIVE_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.proxy-authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["x-access-token"]',
  ...SENSITIVE_LOG_HEADER_NAMES.map((field) => `req.headers["${field}"]`),
  ...SENSITIVE_LOG_FIELD_NAMES.flatMap((field) => [
    `req.body.${field}`,
    `req.body.*.${field}`,
    `req.query.${field}`,
    `req.query.*.${field}`,
  ]),
  'err.query',
  'err.parameters',
  'err.detail',
  'err.where',
  'err.driverError.detail',
  'err.driverError.where',
];

type HttpErrorLogObject = Record<string, unknown> & { err?: unknown };

type SerializedHttpRequest = Record<string, unknown> & {
  url?: unknown;
  originalUrl?: unknown;
};

const SENSITIVE_QUERY_PARAMETER_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_LOG_FIELD_NAMES.map(escapeRegExp).join('|')})=)[^&#]*`,
  'gi',
);

export function sanitizeRequestUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(SENSITIVE_QUERY_PARAMETER_PATTERN, '$1[REDACTED]');
}

export function sanitizeHttpRequest(
  request: SerializedHttpRequest,
): SerializedHttpRequest {
  return {
    ...request,
    ...(request.url === undefined
      ? {}
      : { url: sanitizeRequestUrl(request.url) }),
    ...(request.originalUrl === undefined
      ? {}
      : { originalUrl: sanitizeRequestUrl(request.originalUrl) }),
  };
}

export function httpErrorLogObject(
  _request: IncomingMessage,
  _response: ServerResponse,
  error: Error,
  value: HttpErrorLogObject,
): HttpErrorLogObject {
  if (!isSyntheticHttpStatusError(error)) {
    return { ...value, event: 'http_transport_error' };
  }

  const { err: _syntheticError, ...accessLog } = value;
  return { ...accessLog, event: 'http_request_failed' };
}

export function httpErrorLogMessage(
  _request: IncomingMessage,
  _response: ServerResponse,
  error: Error,
): string {
  return isSyntheticHttpStatusError(error)
    ? 'request completed with error response'
    : 'request transport errored';
}

function isSyntheticHttpStatusError(error: Error): boolean {
  return /^failed with status code [5-9]\d{2}$/.test(error.message);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logging = configService.getOrThrow<LoggingConfig>('logging');

        return {
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: logging.level,
            genReqId: (req: IncomingMessage & { id?: string }) =>
              req.id ?? randomUUID(),
            redact: {
              paths: SENSITIVE_LOG_REDACTION_PATHS,
              censor: '[REDACTED]',
            },
            serializers: {
              req: sanitizeHttpRequest,
            },
            customProps: () => {
              const spanContext = trace.getActiveSpan()?.spanContext();

              return spanContext === undefined
                ? {}
                : {
                    trace_id: spanContext.traceId,
                    span_id: spanContext.spanId,
                  };
            },
            customErrorObject: httpErrorLogObject,
            customErrorMessage: httpErrorLogMessage,
            transport: logging.pretty
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'SYS:standard',
                  },
                }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class AppLoggingModule {}
