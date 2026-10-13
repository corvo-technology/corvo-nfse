import { sentryBootstrapConfig } from './instrument';
import './infra/observability/tracing';
import { createServer, Server, ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import pino from 'pino';
import { WorkerAppModule } from './worker-app.module';
import type {
  AppConfig,
  WorkerConfig,
} from '@/infra/config/configuration.types';
import { HealthResponse, HealthService } from '@/modules/health/health.service';
import {
  captureRuntimeException,
  flushSentry,
} from '@/infra/observability/sentry-reporter';

type HealthRouteHandler = () => HealthResponse | Promise<HealthResponse>;

export type WorkerHealthRouteResponse = {
  statusCode: number;
  body: unknown;
};

export function createWorkerHealthServer(
  healthService: Pick<HealthService, 'getLive' | 'getReady'>,
  apiPrefix: string,
): Server {
  return createServer((request, response) => {
    void resolveWorkerHealthRoute(
      healthService,
      apiPrefix,
      request.method ?? 'GET',
      request.url ?? '/',
      request.headers.host,
    ).then(({ statusCode, body }) => writeJson(response, statusCode, body));
  });
}

export async function resolveWorkerHealthRoute(
  healthService: Pick<HealthService, 'getLive' | 'getReady'>,
  apiPrefix: string,
  method: string,
  requestUrl: string,
  host = 'localhost',
): Promise<WorkerHealthRouteResponse> {
  const normalizedPrefix = apiPrefix.replace(/^\/+|\/+$/g, '');
  const livePath = `/${normalizedPrefix}/health/live`;
  const readyPath = `/${normalizedPrefix}/health/ready`;
  const url = new URL(requestUrl, `http://${host}`);

  if (method !== 'GET') {
    return notFound();
  }

  if (url.pathname === livePath) {
    return handleHealthRoute(() => healthService.getLive(), 'worker');
  }

  if (url.pathname === readyPath) {
    return handleHealthRoute(() => healthService.getReady(), 'worker');
  }

  return notFound();
}

export async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  const logger = app.get(Logger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');
  const workerConfig = configService.getOrThrow<WorkerConfig>('worker');
  const healthService = app.get(HealthService);
  const server = createWorkerHealthServer(healthService, appConfig.apiPrefix);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(workerConfig.port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.log(`Worker health server listening on port ${workerConfig.port}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await app.close();
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  return { app, server };
}

async function handleHealthRoute(
  handler: HealthRouteHandler,
  runtime: 'worker' | 'baileys',
): Promise<WorkerHealthRouteResponse> {
  try {
    return { statusCode: 200, body: await handler() };
  } catch (error) {
    captureRuntimeException(error, runtime, 'health_check');
    return {
      statusCode: 500,
      body: {
        statusCode: 500,
        message: 'Health check failed',
      },
    };
  }
}

function notFound(): WorkerHealthRouteResponse {
  return { statusCode: 404, body: { statusCode: 404, message: 'Not Found' } };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

if (require.main === module) {
  void bootstrapWorker().catch(async (error) => {
    // Nest logs provider bootstrap failures before rethrowing. This handles
    // failures that happen around the worker health server itself.
    pino().error(
      { event: 'worker_bootstrap_failed', err: error },
      'Worker bootstrap failed',
    );
    captureRuntimeException(error, 'worker', 'bootstrap');
    await flushSentry(sentryBootstrapConfig.flushTimeoutMs);
    process.exit(1);
  });
}
