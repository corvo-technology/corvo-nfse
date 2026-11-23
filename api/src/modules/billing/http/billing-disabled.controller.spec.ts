/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DomainExceptionFilter } from '@/shared/http/domain-exception.filter';
import { ResponseInterceptor } from '@/shared/http/response.interceptor';
import { BillingDisabledController } from './billing-disabled.controller';

describe('BillingDisabledController', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BillingDisabledController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalFilters(new DomainExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['get', '/billing'],
    ['get', '/billing/plan'],
    ['post', '/billing/checkout/session'],
    ['get', '/credits'],
    ['get', '/credits/transactions'],
    ['post', '/webhooks/stripe'],
    ['post', '/webhooks/woovi'],
  ] as const)('%s %s answers 404 BILLING_DISABLED', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'ERROR_BILLING_DISABLED',
    });
  });

  it('does not take routes outside billing', async () => {
    const res = await request(app.getHttpServer()).get('/plans').expect(404);
    expect(res.body.code).not.toBe('ERROR_BILLING_DISABLED');
  });
});
