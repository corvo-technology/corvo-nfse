import type { INestApplication } from '@nestjs/common';
import {
  GLOBAL_PREFIX_EXCLUDES,
  configureHttpGlobalPrefix,
} from './bootstrap-http';

describe('configureHttpGlobalPrefix', () => {
  it('applies the API prefix to every route', () => {
    const app = {
      setGlobalPrefix: jest.fn(),
      use: jest.fn(),
    } as unknown as INestApplication;

    configureHttpGlobalPrefix(app, 'v1');

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('v1', {
      exclude: GLOBAL_PREFIX_EXCLUDES,
    });
    expect(GLOBAL_PREFIX_EXCLUDES).toEqual(
      expect.arrayContaining([
        '/health',
        '/.well-known/mcp.json',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-authorization-server',
      ]),
    );
  });
});
