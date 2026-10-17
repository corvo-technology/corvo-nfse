/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { configureHttpTransport } from '@/bootstrap-http';
import { DomainExceptionFilter } from './domain-exception.filter';
import { ResponseInterceptor, RawResponse } from './response.interceptor';
import { CursorQuery, paginateItems } from './pagination';
import { createValidationPipe } from './validation-pipe';
import {
  CompanyNotFoundError,
  CompanyAlreadyExistsError,
} from '@/modules/company/domain/errors';
import { CertificateTaxIdMismatchError } from '@/modules/certificate/domain/errors';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { data } from './response';

@Controller('contract')
class ContractController {
  @Get() single() {
    return { id: 'one' };
  }
  @Get('wrapped') wrapped() {
    return data({ id: 'one' });
  }
  @Get('data-property') dataProperty() {
    return { data: 'domain value', other: true };
  }
  @Get('list') list(@Query() query: CursorQuery) {
    return paginateItems(
      [{ id: 'a' }, { id: 'b' }],
      query.limit ?? 1,
      (item) => item,
    );
  }
  @Get('bad-request') badRequest() {
    throw new BadRequestException('Invalid input');
  }
  @Get('missing') missing() {
    throw new CompanyNotFoundError('private-company-id');
  }
  @Get('certificate-mismatch') certificateMismatch() {
    throw new CertificateTaxIdMismatchError('RLJ1XFI8000102', '11222333000181');
  }
  @Get('certificate-mismatch-plain') certificateMismatchPlain() {
    throw new CertificateTaxIdMismatchError();
  }
  @Get('conflict') conflict() {
    throw new CompanyAlreadyExistsError('private-tax-id');
  }
  @Get('validation') validation() {
    throw new FiscalValidationError([
      {
        field: 'customer.taxId',
        code: 'invalid_tax_id',
        message: 'Invalid tax ID',
      },
    ]);
  }
  @Get('unknown') unknown() {
    throw new Error('SECRET SQL credentials');
  }
  @Get('timeout') timeout() {
    throw new HttpException('SECRET dependency response', 504);
  }
  @Get('database') database() {
    throw new QueryFailedError(
      'SECRET SQL',
      ['password'],
      Object.assign(new Error('db'), {
        code: '23505',
        constraint: 'private_constraint',
      }),
    );
  }
  @Get('raw') @RawResponse() raw() {
    return { jsonrpc: '2.0', result: true };
  }
  @Get('file') @RawResponse() file() {
    return new StreamableFile(Buffer.from('PDF'));
  }
  @Post('empty') @HttpCode(204) empty() {}
  @Post() post() {
    return { accepted: true };
  }
}

describe('HTTP contract through Nest/Express', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContractController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      rawBody: true,
    });
    configureHttpTransport(app);
    app.useGlobalFilters(new DomainExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('shows which tax ids a certificate mismatch compared, and nothing else', async () => {
    const res = await request(app.getHttpServer())
      .get('/contract/certificate-mismatch')
      .expect(422);
    expect(res.body).toMatchObject({
      code: 'ERROR_CERTIFICATE_TAX_ID_MISMATCH',
      details: {
        certificateTaxId: 'RLJ1XFI8000102',
        companyTaxId: '11222333000181',
      },
    });
    const plain = await request(app.getHttpServer())
      .get('/contract/certificate-mismatch-plain')
      .expect(422);
    expect(plain.body.code).toBe('ERROR_CERTIFICATE_TAX_ID_MISMATCH');
    expect(plain.body.details).toBeUndefined();
  });
  it('wraps successes once and does not guess from a data property', async () => {
    for (const path of ['', '/wrapped'])
      expect(
        (await request(app.getHttpServer()).get(`/contract${path}`).expect(200))
          .body,
      ).toEqual({ data: { id: 'one' } });
    expect(
      (await request(app.getHttpServer()).get('/contract/data-property')).body,
    ).toEqual({ data: { data: 'domain value', other: true } });
  });
  it('returns cursor metadata without exposing the extra item', async () => {
    expect(
      (await request(app.getHttpServer()).get('/contract/list?limit=1')).body,
    ).toEqual({
      data: [{ id: 'a' }],
      pagination: { limit: 1, hasMore: true, nextCursor: expect.any(String) },
    });
  });
  it.each(['0', '-1', '1001', '1.2', 'abc', '', '1&limit=2'])(
    'rejects invalid limits %s',
    async (limit) => {
      const result = await request(app.getHttpServer())
        .get(`/contract/list?limit=${limit}`)
        .expect(400);
      expect(result.body.code).toBe('ERROR_INVALID_LIMIT');
    },
  );
  it('rejects removed page/offset parameters', async () => {
    for (const query of ['offset=1', 'page=2', 'pageSize=20']) {
      const result = await request(app.getHttpServer())
        .get(`/contract/list?${query}`)
        .expect(400);
      expect(result.body.details[0].code).toBe('ERROR_UNKNOWN_FIELD');
    }
  });
  it.each([
    ['bad-request', 400, 'ERROR_BAD_REQUEST'],
    ['missing', 404, 'ERROR_COMPANY_NOT_FOUND'],
    ['conflict', 409, 'ERROR_COMPANY_ALREADY_EXISTS'],
    ['validation', 422, 'ERROR_VALIDATION'],
    ['unknown', 500, 'ERROR_INTERNAL'],
    ['timeout', 504, 'ERROR_GATEWAY_TIMEOUT'],
    ['database', 409, 'ERROR_DATABASE_UNIQUE_CONSTRAINT'],
  ])('normalizes %s without leaking internals', async (path, status, code) => {
    const result = await request(app.getHttpServer())
      .get(`/contract/${path}`)
      .expect(Number(status));
    expect(result.body).toMatchObject({
      statusCode: status,
      code,
      message: expect.any(String),
      requestId: result.headers['x-request-id'],
    });
    expect(JSON.stringify(result.body)).not.toMatch(/SECRET|private_|private-/);
    expect(result.body).not.toHaveProperty('error');
    expect(result.body).not.toHaveProperty('constraint');
  });
  it('normalizes missing routes, malformed JSON and oversized bodies before controllers', async () => {
    const missing = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);
    expect(missing.body.code).toBe('ERROR_NOT_FOUND');
    const malformed = await request(app.getHttpServer())
      .post('/contract')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(malformed.body.code).toBe('ERROR_INVALID_JSON');
    expect(malformed.body.requestId).toBe(malformed.headers['x-request-id']);
    const oversized = await request(app.getHttpServer())
      .post('/contract')
      .send({ value: 'a'.repeat(1048576) })
      .expect(413);
    expect(oversized.body.code).toBe('ERROR_PAYLOAD_TOO_LARGE');
  });
  it('preserves raw protocol/file responses and 204', async () => {
    expect(
      (await request(app.getHttpServer()).get('/contract/raw')).body,
    ).toEqual({ jsonrpc: '2.0', result: true });
    expect(
      (await request(app.getHttpServer()).get('/contract/file')).text,
    ).toBeUndefined();
    expect(
      (await request(app.getHttpServer()).post('/contract/empty').expect(204))
        .text,
    ).toBe('');
  });
});
