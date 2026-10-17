import { randomUUID } from 'node:crypto';
import { apiErrorBody, DOMAIN_ERRORS } from './api-error';
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { QueryFailedError } from 'typeorm';
import {
  TenantInvitationExpiredError,
  TenantInvitationNotFoundError,
  TenantInvitationNotRenewableError,
} from '@/modules/auth/domain/errors';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import {
  ApplicationError,
  isApplicationError,
} from '@/shared/errors/application-error';
import { captureUnhandledHttpException } from '@/infra/observability/sentry-reporter';

type HttpResponse = {
  status(code: number): HttpResponse;
  json(body: unknown): void;
};

type HttpRequest = {
  id?: unknown;
  method?: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  route?: { path?: string };
  body?: { id?: unknown };
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const originalResponse = http.getResponse<HttpResponse>();
    const requestId =
      typeof request?.id === 'string' ? request.id : randomUUID();
    if (request) request.id = requestId;
    let statusCode = 500;
    const response: HttpResponse = {
      status(code: number) {
        statusCode = code;
        originalResponse.status(code);
        return response;
      },
      json(body: unknown) {
        const path = requestPath(request) ?? '';
        if (/\/mcp\/(token|revoke|authorize|callback|consent)$/.test(path)) {
          const native =
            body && typeof body === 'object'
              ? (body as Record<string, unknown>)
              : {};
          const safeCode =
            typeof native.error === 'string' &&
            [
              'invalid_request',
              'invalid_client',
              'invalid_grant',
              'unauthorized_client',
              'unsupported_grant_type',
              'invalid_scope',
            ].includes(native.error)
              ? native.error
              : 'invalid_request';
          originalResponse.json({
            error:
              statusCode === 429
                ? 'temporarily_unavailable'
                : statusCode >= 500
                  ? 'server_error'
                  : safeCode,
            error_description:
              statusCode < 500 && typeof native.error_description === 'string'
                ? native.error_description
                : apiErrorBody(statusCode, body, requestId).message,
          });
        } else if (/\/mcp$/.test(path)) {
          originalResponse.json({
            jsonrpc: '2.0',
            id: request?.body?.id ?? null,
            error: {
              code: -32000,
              message: apiErrorBody(statusCode, body, requestId).message,
            },
          });
        } else originalResponse.json(apiErrorBody(statusCode, body, requestId));
      },
    };

    // Express body-parser failures happen before guards and pipes.
    if (
      exception &&
      typeof exception === 'object' &&
      !(exception instanceof HttpException)
    ) {
      const parserError = exception as { type?: string; status?: number };
      if (
        [
          'entity.parse.failed',
          'entity.too.large',
          'encoding.unsupported',
          'charset.unsupported',
        ].includes(parserError.type ?? '')
      ) {
        const status =
          parserError.status === 413
            ? 413
            : parserError.status === 415
              ? 415
              : 400;
        response
          .status(status)
          .json({ code: status === 400 ? 'ERROR_INVALID_JSON' : undefined });
        return;
      }
    }

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(body);
      return;
    }

    if (exception instanceof FiscalValidationError) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: 422,
        error: 'Bad Request',
        code: 'validation_error',
        message: 'Request validation failed',
        details: exception.issues,
      });
      return;
    }

    if (isApplicationError(exception)) {
      const statusCode = statusForApplicationError(exception);
      if (statusCode < 500) {
        this.logBusinessError(exception, request, statusCode);
        response
          .status(statusCode)
          .json(applicationErrorBody(exception, statusCode, request?.id));
        return;
      }

      this.logOperationalException(exception, request, statusCode, {
        failureKind: exception.kind,
        errorCode: exception.code,
        retryable: exception.retryable,
      });
      response
        .status(statusCode)
        .json(safeServerErrorBody(statusCode, exception.code, request?.id));
      return;
    }

    if (exception instanceof QueryFailedError) {
      const databaseError = mapDatabaseError(exception);
      if (databaseError) {
        this.logger.debug({
          event: 'database_constraint_violation',
          ...databaseErrorDiagnostics(exception),
        });
        response.status(databaseError.statusCode).json(databaseError.body);
        return;
      }
    }

    if (exception instanceof Error) {
      const invitationError = mapInvitationError(exception);
      if (invitationError) {
        response.status(invitationError.statusCode).json(invitationError.body);
        return;
      }

      const status = statusForDomainError(exception);
      if (status) {
        response.status(status).json({
          error: safeDomainMessage(exception),
          code: domainErrorCode(exception),
          ...safeDomainDetails(exception),
        });
        return;
      }
    }

    const unhandledStatus =
      exception instanceof HttpException && exception.getStatus() >= 500
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    this.logOperationalException(exception, request, unhandledStatus, {
      failureKind: 'internal',
    });

    response
      .status(unhandledStatus)
      .json(safeServerErrorBody(unhandledStatus, undefined, request?.id));
  }

  private logBusinessError(
    exception: ApplicationError,
    request: HttpRequest | undefined,
    statusCode: number,
  ): void {
    const entry = {
      event: 'business_rule_rejected',
      errorCode: exception.code,
      failureKind: exception.kind,
      statusCode,
      requestId: request?.id,
      http: {
        method: request?.method,
        route: requestRouteTemplate(request),
      },
    };
    if (exception.kind === 'conflict' || exception.kind === 'forbidden') {
      this.logger.warn(entry);
    } else {
      this.logger.log(entry);
    }
  }

  private logOperationalException(
    exception: unknown,
    request: HttpRequest | undefined,
    statusCode: number,
    diagnostics: {
      failureKind: string;
      errorCode?: string;
      retryable?: boolean;
    },
  ): void {
    const error = normalizeException(exception);
    let spanContext:
      | {
          traceId: string;
          spanId: string;
        }
      | undefined;

    try {
      const span = trace.getActiveSpan();
      spanContext = span?.spanContext();
      span?.recordException(error);
      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.name,
      });
    } catch {
      // Observability must never prevent the sanitized HTTP response.
    }

    try {
      const sentryEventId = captureUnhandledHttpException(error, {
        statusCode,
        method: request?.method,
        route: requestRouteTemplate(request),
        requestId: typeof request?.id === 'string' ? request.id : undefined,
        traceId: spanContext?.traceId,
        spanId: spanContext?.spanId,
        failureKind: diagnostics.failureKind,
        errorCode: diagnostics.errorCode,
        retryable: diagnostics.retryable,
      });

      this.logger.error({
        event: 'unhandled_http_exception',
        msg: 'Unhandled HTTP exception',
        err: error,
        errorName: error.name,
        statusCode,
        failureKind: diagnostics.failureKind,
        errorCode: diagnostics.errorCode,
        retryable: diagnostics.retryable,
        requestId: request?.id,
        http: {
          method: request?.method,
          path: requestPath(request),
        },
        ...(sentryEventId ? { sentryEventId } : {}),
        ...(spanContext
          ? {
              trace_id: spanContext.traceId,
              span_id: spanContext.spanId,
            }
          : {}),
        ...(exception instanceof Error ? {} : { thrownType: typeof exception }),
      });
    } catch {
      // Logging failures must not replace the original application failure.
    }
  }
}

function statusForApplicationError(error: ApplicationError): number {
  switch (error.kind) {
    case 'validation':
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case 'not_found':
      return HttpStatus.NOT_FOUND;
    case 'conflict':
      return HttpStatus.CONFLICT;
    case 'forbidden':
      return HttpStatus.FORBIDDEN;
    case 'dependency':
      return error.retryable
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.BAD_GATEWAY;
    case 'internal':
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

function applicationErrorBody(
  error: ApplicationError,
  statusCode: number,
  requestId?: unknown,
): Record<string, unknown> {
  return {
    statusCode,
    message: error.safeMessage,
    error: httpErrorLabel(statusCode),
    code: error.code,
    ...(error.safeDetails ? { details: error.safeDetails } : {}),
    ...safeRequestId(requestId),
  };
}

function safeServerErrorBody(
  statusCode: number,
  code?: string,
  requestId?: unknown,
): Record<string, unknown> {
  if (statusCode === 502) {
    return {
      statusCode,
      message: 'Upstream service unavailable',
      error: 'Bad Gateway',
      ...(code ? { code } : {}),
      ...safeRequestId(requestId),
    };
  }
  if (statusCode === 503) {
    return {
      statusCode,
      message: 'Service temporarily unavailable',
      error: 'Service Unavailable',
      ...(code ? { code } : {}),
      retryable: true,
      ...safeRequestId(requestId),
    };
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
    error: 'Internal Server Error',
    ...safeRequestId(requestId),
  };
}

function safeRequestId(requestId: unknown): { requestId?: string } {
  if (typeof requestId === 'string' && requestId.length > 0) {
    return { requestId };
  }
  if (typeof requestId === 'number' && Number.isFinite(requestId)) {
    return { requestId: String(requestId) };
  }
  return {};
}

function httpErrorLabel(statusCode: number): string {
  switch (statusCode) {
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 403:
      return 'Forbidden';
    case 422:
      return 'Unprocessable Entity';
    default:
      return 'Error';
  }
}

function normalizeException(exception: unknown): Error {
  if (exception instanceof Error) return exception;
  const error = new Error('A non-Error value was thrown');
  error.name = 'NonErrorThrown';
  return error;
}

function requestPath(request: HttpRequest | undefined): string | undefined {
  const url = request?.originalUrl ?? request?.url;
  return url?.split('?', 1)[0];
}

function requestRouteTemplate(
  request: HttpRequest | undefined,
): string | undefined {
  const routePath = request?.route?.path;
  if (!routePath) return undefined;
  return `${request?.baseUrl ?? ''}${routePath}`;
}

function databaseErrorDiagnostics(
  error: QueryFailedError,
): Record<string, string | undefined> {
  const driverError = error.driverError as
    | {
        code?: string;
        schema?: string;
        table?: string;
        column?: string;
        constraint?: string;
        routine?: string;
      }
    | undefined;

  return {
    code: driverError?.code,
    schema: driverError?.schema,
    table: driverError?.table,
    column: driverError?.column,
    constraint: driverError?.constraint,
    routine: driverError?.routine,
  };
}

function mapInvitationError(error: Error): {
  statusCode: number;
  body: Record<string, unknown>;
} | null {
  let mapping: { statusCode: number; error: string; code: string } | null =
    null;
  if (error instanceof TenantInvitationExpiredError) {
    mapping = {
      statusCode: HttpStatus.GONE,
      error: 'Gone',
      code: 'TENANT_INVITATION_EXPIRED',
    };
  } else if (error instanceof TenantInvitationNotFoundError) {
    mapping = {
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      code: 'TENANT_INVITATION_NOT_FOUND',
    };
  } else if (error instanceof TenantInvitationNotRenewableError) {
    mapping = {
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: 'TENANT_INVITATION_NOT_RENEWABLE',
    };
  }
  if (!mapping) return null;
  return {
    statusCode: mapping.statusCode,
    body: {
      statusCode: mapping.statusCode,
      error: mapping.error,
      message: error.message,
      code: mapping.code,
    },
  };
}

function mapDatabaseError(error: QueryFailedError): {
  statusCode: number;
  body: Record<string, unknown>;
} | null {
  const driverError = error.driverError as
    | { code?: string; constraint?: string }
    | undefined;

  if (driverError?.code === '23505') {
    return {
      statusCode: HttpStatus.CONFLICT,
      body: {
        statusCode: HttpStatus.CONFLICT,
        message: 'Resource already exists',
        error: 'Conflict',
        code: 'DATABASE_UNIQUE_CONSTRAINT',
      },
    };
  }

  if (
    driverError?.code === '23502' ||
    driverError?.code === '23503' ||
    driverError?.code === '23514'
  ) {
    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      body: {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Database constraint violation',
        error: 'Unprocessable Entity',
        code: 'DATABASE_CONSTRAINT_VIOLATION',
      },
    };
  }

  return null;
}

function statusForDomainError(error: Error): number | null {
  return DOMAIN_ERRORS[error.name]?.status ?? null;
}
function domainErrorCode(error: Error): string {
  return DOMAIN_ERRORS[error.name]?.code ?? 'ERROR_INTERNAL';
}
function safeDomainDetails(error: Error): { details?: object } {
  const details = (error as { safeDetails?: unknown }).safeDetails;
  return details && typeof details === 'object' ? { details } : {};
}
function safeDomainMessage(error: Error): string {
  return DOMAIN_ERRORS[error.name]?.message ?? 'Internal server error';
}
