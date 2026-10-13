import type { INestApplication } from '@nestjs/common';
import { configureHttpGlobalPrefix } from './bootstrap-http';

describe('configureHttpGlobalPrefix', () => {
  it('applies the API prefix to every route', () => {
    const app = {
      setGlobalPrefix: jest.fn(),
    } as unknown as INestApplication;

    configureHttpGlobalPrefix(app, 'v1');

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('v1', {
      exclude: ['/.well-known/mcp.json'],
    });
  });
});
