import { sentryBootstrapConfig } from './instrument';
import './infra/observability/tracing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { AppConfig } from '@/infra/config/configuration';
import { createHttpApp, resolveCorsOptions } from './bootstrap-http';
import pino from 'pino';
import {
  captureRuntimeException,
  flushSentry,
} from '@/infra/observability/sentry-reporter';

export { resolveCorsOptions };

export async function bootstrap() {
  const app = await createHttpApp(AppModule);
  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');

  const server = await app.listen(appConfig.port);
  // Cut slow-header/slow-body connections early (slowloris); Node defaults are 60s/300s.
  server.headersTimeout =
    configService.get<number>('HTTP_HEADERS_TIMEOUT_MS') ?? 15000;
  server.requestTimeout =
    configService.get<number>('HTTP_REQUEST_TIMEOUT_MS') ?? 60000;
  pino().info(
    {
      event: 'runtime_started',
      runtime: 'api',
      port: appConfig.port,
      apiPrefix: appConfig.apiPrefix,
    },
    'API runtime listening',
  );
  pino().info(
    {
      event: 'cors_origins_configured',
      corsOrigins: appConfig.corsOrigins,
    },
    'CORS origins configured',
  );
}

if (require.main === module) {
  void bootstrap().catch(async (error) => {
    pino().error({ event: 'api_bootstrap_failed', err: error });
    captureRuntimeException(error, 'api', 'bootstrap');
    await flushSentry(sentryBootstrapConfig.flushTimeoutMs);
    process.exit(1);
  });
}
