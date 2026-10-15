import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('greenflow.fiscal');
const dpsValidationFailures = meter.createCounter(
  'dps_validation_failures_total',
  { description: 'DPS rejected locally (layout or schema) before any transmission' },
);
const authorizationFailures = meter.createCounter(
  'nfse_authorization_failures_total',
  { description: 'DPS permanently rejected by Sefin (no retry)' },
);

/** `code` is a stable `DPS_*` fiscal error code (never free text). */
export function recordDpsValidationFailure(code: string): void {
  dpsValidationFailures.add(1, { code });
}

/** `code` is the Sefin rejection code (or `ISSUE_REJECTED` when absent). */
export function recordAuthorizationFailure(code: string): void {
  authorizationFailures.add(1, { code });
}
