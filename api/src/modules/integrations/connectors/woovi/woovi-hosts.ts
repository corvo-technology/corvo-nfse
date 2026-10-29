import type { IntegrationEnvironment } from '../../domain/connector';

/** Sandbox accounts live on a different host, with their own keys. */
export const wooviBaseUrl = (environment: IntegrationEnvironment): string =>
  environment === 'live'
    ? 'https://api.woovi.com'
    : 'https://api.woovi-sandbox.com';
