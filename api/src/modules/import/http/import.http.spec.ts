/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { ResponseInterceptor } from '@/shared/http/response.interceptor';
import { ImportController } from './import.controller';
import { ImportIntakeService } from '../application/import-intake.service';
import { ImportReviewService } from '../application/import-review.service';
import { ImportEmitService } from '../application/import-emit.service';

/**
 * Goes through the real response interceptor: a plain object answered by a handler is wrapped in
 * { data }, so a list must be a CursorPage (or a DataEnvelope) to reach the client as the web expects.
 */
describe('imports over HTTP (real response interceptor)', () => {
  let app: INestApplication;
  const review = {
    listRows: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    updateRow: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [
        { provide: ImportIntakeService, useValue: {} },
        { provide: ImportReviewService, useValue: review },
        { provide: ImportEmitService, useValue: {} },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (req: { authContext?: unknown }, _res: unknown, next: () => void) => {
        req.authContext = {
          activeTenantId: 't1',
          authUserId: 'u1',
          executionEnvironment: 'live',
          permissions: ['nfse.invoices.issue'],
        };
        next();
      },
    );
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.resetAllMocks());

  const row = {
    line: 4,
    data: { amount: 10 },
    status: 'invalid',
    errorCode: 'ERROR_VALIDATION',
    errorMessage: 'bad',
    invoiceId: null,
  };

  it('GET /imports/:id/rows answers { data: [rows], pagination } with the rows at the top level', async () => {
    review.listRows.mockResolvedValue({ items: [row], nextCursor: '4' });
    const res = await request(app.getHttpServer())
      .get(
        '/imports/11111111-1111-4111-8111-111111111111/rows?status=invalid&limit=50',
      )
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      line: 4,
      status: 'invalid',
      error_code: 'ERROR_VALIDATION',
    });
    expect(res.body.pagination).toMatchObject({
      limit: 50,
      hasMore: true,
      nextCursor: '4',
    });
  });

  it('GET /imports answers { data: [imports] }, one level, not wrapped twice', async () => {
    review.list.mockResolvedValue([
      {
        id: 'i1',
        status: 'done',
        fileName: 'n.csv',
        companyId: null,
        errorCode: null,
        rowsExpected: 3,
        emitStartedAt: null,
        emitFinishedAt: null,
        createdAt: new Date('2026-11-07T10:00:00Z'),
        counters: {
          total: 1,
          valid: 0,
          invalid: 0,
          accepted: 1,
          authorized: 1,
          awaitingCredits: 0,
          validAmount: 0,
          awaitingAmount: 0,
          failed: 0,
          pending: 0,
        },
      },
    ]);
    const res = await request(app.getHttpServer()).get('/imports').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ id: 'i1', file_name: 'n.csv' });
  });

  it('GET /imports/:id and PATCH a row answer a single { data: object }', async () => {
    review.get.mockResolvedValue({
      id: 'i1',
      status: 'ready',
      fileName: 'n.csv',
      companyId: null,
      errorCode: null,
      rowsExpected: 1,
      emitStartedAt: null,
      emitFinishedAt: null,
      createdAt: new Date(),
      counters: {
        total: 1,
        valid: 1,
        invalid: 0,
        accepted: 0,
        authorized: 0,
        awaitingCredits: 0,
        validAmount: 5,
        awaitingAmount: 0,
        failed: 0,
        pending: 1,
      },
    });
    const one = await request(app.getHttpServer())
      .get('/imports/11111111-1111-4111-8111-111111111111')
      .expect(200);
    expect(one.body.data).toMatchObject({
      id: 'i1',
      counters: { valid_amount: 5 },
    });
    review.updateRow.mockResolvedValue(row);
    const patched = await request(app.getHttpServer())
      .patch('/imports/11111111-1111-4111-8111-111111111111/rows/4')
      .send({ item: { amount: 10 } })
      .expect(200);
    expect(patched.body.data).toMatchObject({
      line: 4,
      error_code: 'ERROR_VALIDATION',
    });
  });
});
