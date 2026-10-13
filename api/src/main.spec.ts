import type { AppConfig } from '@/infra/config/configuration';
import { resolveCorsOptions } from './main';

describe('resolveCorsOptions', () => {
  const baseAppConfig: AppConfig = {
    name: 'greenflow-backend',
    version: '1.0.0',
    nodeEnv: 'production',
    port: 3000,
    apiPrefix: 'v1',
    corsOrigins: ['https://app.greenflow.com'],
  };

  it('keeps development restricted to configured origins', () => {
    expect(
      resolveCorsOptions({
        ...baseAppConfig,
        nodeEnv: 'development',
        corsOrigins: ['http://localhost:5173'],
      }),
    ).toEqual({
      origin: ['http://localhost:5173'],
      credentials: true,
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ],
    });
  });

  it('allows the local Next proxy origin when explicitly configured', () => {
    expect(
      resolveCorsOptions({
        ...baseAppConfig,
        nodeEnv: 'development',
        corsOrigins: ['http://localhost:4000', 'http://localhost:5173'],
      }),
    ).toEqual({
      origin: ['http://localhost:4000', 'http://localhost:5173'],
      credentials: true,
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ],
    });
  });

  it('keeps production restricted to configured origins', () => {
    expect(resolveCorsOptions(baseAppConfig)).toEqual({
      origin: ['https://app.greenflow.com'],
      credentials: true,
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ],
    });
  });

  it('keeps test restricted to configured origins', () => {
    expect(
      resolveCorsOptions({
        ...baseAppConfig,
        nodeEnv: 'test',
        corsOrigins: ['http://localhost:5173'],
      }),
    ).toEqual({
      origin: ['http://localhost:5173'],
      credentials: true,
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ],
    });
  });
});
