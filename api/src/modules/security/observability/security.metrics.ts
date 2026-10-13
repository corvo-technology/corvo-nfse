import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('greenflow.security');
const authCounter = meter.createCounter('greenflow.auth.events.total');
const csrfCounter = meter.createCounter('greenflow.auth.csrf.failures.total');
const humanCounter = meter.createCounter(
  'greenflow.security.human_proof.events.total',
);
const authLoginStageDuration = meter.createHistogram(
  'greenflow.auth.session_login.stage.duration',
  { unit: 's' },
);
const authContextCacheCounter = meter.createCounter(
  'greenflow.auth.context_cache.events.total',
);
const otpCounter = meter.createCounter('greenflow.security.otp.events.total');

export const recordAuthEvent = (event: string, reason?: string) =>
  authCounter.add(1, { event, ...(reason ? { reason } : {}) });

export const recordCsrfFailure = (reason: string) =>
  csrfCounter.add(1, { reason });

export const recordHumanProofEvent = (
  event: string,
  action: string,
  productKey?: string,
) =>
  humanCounter.add(1, {
    event,
    action,
    ...(productKey ? { product: productKey } : {}),
  });

export const recordAuthLoginStageDuration = (
  stage: string,
  durationMs: number,
  status: 'ok' | 'error' = 'ok',
) => authLoginStageDuration.record(durationMs / 1000, { stage, status });

export const recordAuthContextCacheEvent = (
  event: 'hit' | 'miss' | 'set' | 'invalidate' | 'error',
  operation?: string,
) =>
  authContextCacheCounter.add(1, {
    event,
    ...(operation ? { operation } : {}),
  });

export const recordOtpEvent = (
  event: string,
  channel?: string,
  purpose?: string,
  audience?: string,
) =>
  otpCounter.add(1, {
    event,
    ...(channel ? { channel } : {}),
    ...(purpose ? { purpose } : {}),
    ...(audience ? { audience } : {}),
  });
