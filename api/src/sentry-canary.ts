import { sentryBootstrapConfig } from './instrument';
import * as Sentry from '@sentry/nestjs';
import pino from 'pino';
import { flushSentry } from './infra/observability/sentry-reporter';

export async function runSentryCanary(): Promise<boolean> {
  const client = Sentry.getClient();
  if (!client?.getDsn() || client.getOptions().enabled === false) return false;

  const eventId = Sentry.withScope((scope) => {
    scope.setTag('runtime', 'canary');
    scope.setTag('canary', 'true');
    return Sentry.captureException(new Error('greenflow_sentry_canary'));
  });
  const flushed = await flushSentry(sentryBootstrapConfig.flushTimeoutMs);
  pino().info({ event: 'sentry_canary', eventId, flushed });
  return flushed;
}

if (require.main === module) {
  void runSentryCanary().then((success) => {
    process.exit(success ? 0 : 1);
  });
}
