import { setupOpenApi } from '@/infra/openapi/setup';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  HttpException,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { createValidationPipe } from '@/shared/http/validation-pipe';
import type { AppConfig } from '@/infra/config/configuration';

export function resolveCorsOptions(appConfig: AppConfig): CorsOptions {
  return {
    origin: appConfig.corsOrigins,
    credentials: true,
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
  };
}

/**
 * Paths served at the domain root, outside the versioned API prefix.
 * MCP clients discover the server via `/.well-known/mcp.json`, which must
 * not be namespaced under `/v1`.
 */
export const GLOBAL_PREFIX_EXCLUDES = ['/.well-known/mcp.json'];

export function configureHttpGlobalPrefix(
  app: INestApplication,
  apiPrefix: string,
): void {
  app.setGlobalPrefix(apiPrefix, { exclude: GLOBAL_PREFIX_EXCLUDES });
}

export async function createHttpApp(rootModule: Type<unknown>) {
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    rawBody: true,
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');

  app.useLogger(app.get(Logger));
  app.enableCors(resolveCorsOptions(appConfig));
  configureHttpTransport(app);
  app.enableShutdownHooks();
  configureHttpGlobalPrefix(app, appConfig.apiPrefix);
  app.useGlobalPipes(createValidationPipe());
  setupOpenApi(app, configService);

  return app;
}

export function configureHttpTransport(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    (req: Request & { id?: string }, res: Response, next: NextFunction) => {
      req.id = randomUUID();
      res.setHeader('X-Request-Id', req.id);
      next();
    },
  );
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', {
    limit: '100kb',
    extended: true,
  });
  app.use(
    (error: unknown, _req: Request, _res: Response, next: NextFunction) => {
      const failure = error as { type?: string; status?: number };
      if (failure?.type === 'entity.parse.failed')
        return next(
          new HttpException(
            { code: 'ERROR_INVALID_JSON', message: 'Invalid JSON body' },
            400,
          ),
        );
      if (failure?.type === 'entity.too.large')
        return next(
          new HttpException(
            {
              code: 'ERROR_PAYLOAD_TOO_LARGE',
              message: 'Request payload too large',
            },
            413,
          ),
        );
      if (
        failure?.type === 'encoding.unsupported' ||
        failure?.type === 'charset.unsupported'
      )
        return next(
          new HttpException(
            {
              code: 'ERROR_UNSUPPORTED_MEDIA_TYPE',
              message: 'Unsupported content encoding',
            },
            415,
          ),
        );
      next(error);
    },
  );
}
