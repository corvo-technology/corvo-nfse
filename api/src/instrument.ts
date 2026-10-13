import * as Sentry from '@sentry/nestjs';
import {
  buildSentryOptions,
  resolveSentryConfig,
} from './infra/observability/sentry-config';

// This is the only direct environment boundary for Sentry. It must run before
// Nest creates ConfigService so bootstrap/configuration failures are captured.
export const sentryBootstrapConfig = resolveSentryConfig(process.env);

Sentry.init(buildSentryOptions(sentryBootstrapConfig));
