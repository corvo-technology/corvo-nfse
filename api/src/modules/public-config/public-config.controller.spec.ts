/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ResponseInterceptor } from '@/shared/http/response.interceptor';
import { PublicConfigController } from './public-config.controller';

async function appWith(values: Record<string, unknown>) {
  const module = await Test.createTestingModule({
    controllers: [PublicConfigController],
    providers: [
      {
        provide: ConfigService,
        useValue: { get: (key: string) => values[key] },
      },
    ],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
  await app.init();
  return app;
}

describe('GET /config', () => {
  it('describes a cloud deployment', async () => {
    const app = await appWith({
      DEPLOYMENT_MODE: 'cloud',
      AUTH_SIGNUP_MODE: 'open',
      TURNSTILE_SITE_KEY: '0x4AAAA-site-key',
    });
    const res = await request(app.getHttpServer()).get('/config').expect(200);
    expect(res.body).toEqual({
      deploymentMode: 'cloud',
      billingEnabled: true,
      signupMode: 'open',
      turnstileSiteKey: '0x4AAAA-site-key',
    });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    await app.close();
  });

  it('describes a self-hosted deployment without a Turnstile key', async () => {
    const app = await appWith({
      DEPLOYMENT_MODE: 'self_hosted',
      AUTH_SIGNUP_MODE: 'closed',
    });
    const res = await request(app.getHttpServer()).get('/config').expect(200);
    expect(res.body).toEqual({
      deploymentMode: 'self_hosted',
      billingEnabled: false,
      signupMode: 'closed',
      turnstileSiteKey: null,
    });
    await app.close();
  });

  it('exposes exactly four fields and never a secret', async () => {
    const app = await appWith({
      DEPLOYMENT_MODE: 'cloud',
      TURNSTILE_SECRET_KEY: 'secret',
      STRIPE_SECRET_KEY: 'sk_live',
      AUTH_JWT_SECRET: 'jwt',
    });
    const res = await request(app.getHttpServer()).get('/config').expect(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'billingEnabled',
      'deploymentMode',
      'signupMode',
      'turnstileSiteKey',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|sk_live|jwt/i);
    await app.close();
  });
});
