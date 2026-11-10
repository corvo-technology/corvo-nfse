import { readFileSync } from 'node:fs';
import { InvoiceSubstitutionService } from '@/modules/invoice/application/invoice-substitution.service';
import { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmUnitOfWork } from '@/infra/persistence/typeorm/typeorm-unit-of-work';
import { CompanyService } from '@/modules/company/application/company.service';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import { CompanyServiceTaxProfileService } from '@/modules/company/application/company-service-tax-profile.service';
import { CompanyDomainService } from '@/modules/company/domain/company-domain.service';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { CompanyFiscalProfileOrmEntity } from '@/modules/company/infra/company-fiscal-profile.orm-entity';
import { CompanyServiceTaxProfileOrmEntity } from '@/modules/company/infra/company-service-tax-profile.orm-entity';
import { TypeOrmCompanyRepository } from '@/modules/company/infra/typeorm-company.repository';
import { TypeOrmCompanyFiscalProfileRepository } from '@/modules/company/infra/typeorm-company-fiscal-profile.repository';
import { TypeOrmCompanyServiceTaxProfileRepository } from '@/modules/company/infra/typeorm-company-service-tax-profile.repository';
import type { AuthContext } from '@/modules/auth/auth-context';
import { TenantContextGuard } from '@/modules/auth/tenant-context.guard';
import { PermissionGuard } from '@/modules/auth/permission.guard';
import { RoutePermissionService } from '@/modules/auth/application/route-permission.service';
import { DomainExceptionFilter } from '@/shared/http/domain-exception.filter';
import { HttpApiRateLimitGuard } from '@/shared/http/rate-limit.guard';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';
import { IFiscalProfileReader } from './domain/fiscal/ports/fiscal-profile.reader';
import { IServiceProfileReader } from './domain/fiscal/ports/service-profile.reader';
import { IFiscalCatalog } from './domain/fiscal/classification/fiscal-catalog.port';
import { RtcCalculatorPort } from './domain/fiscal/rtc/rtc-calculator.port';
import { Invoice } from './domain/invoice';
import { err } from './domain/fiscal/result';
import { fiscalError } from './domain/fiscal/fiscal-error';
import type { OutboxMessage } from './domain/outbox-message';
import { InvoiceDomainService } from './domain/invoice-domain.service';
import type { CreateInvoiceDto } from './http/invoice.dto';
import { InvoiceController } from './http/invoice.controller';
import { InvoiceBatchService } from './application/invoice-batch.service';
import { InvoiceService } from './application/invoice.service';
import { InvoiceIntakeService } from './application/invoice-intake.service';
import { InvoiceCalculationService } from './application/fiscal/invoice-calculation.service';
import type { InvoiceCalculationResponse } from './application/fiscal/calculation-response';
import { FiscalEngineService } from './application/fiscal/fiscal-engine.service';
import {
  FISCAL_ENGINE_INTERNAL_PROVIDERS,
  RTC_MAPPER,
} from './application/fiscal/fiscal-engine.module';
import { TypeOrmCompanyFiscalProfileReader } from './application/fiscal/typeorm-company-fiscal-profile.reader';
import { TypeOrmServiceProfileReader } from './application/fiscal/typeorm-service-profile.reader';
import { DefaultRtcMapper } from './infra/fiscal/rtc/default-rtc-mapper';
import { FakeRtcCalculator } from './application/fiscal/testing/fake-rtc-calculator';
import {
  calculationProfile,
  calculationServiceProfile,
} from './application/fiscal/testing/calculation-fixtures';
import { CalculateTaxesHandler } from './application/fiscal/calculate-taxes.handler';
import { FiscalSnapshotService } from './application/fiscal/fiscal-snapshot.service';
import { OutboxService } from './application/outbox.service';
import { OutboxHandlerRegistry } from './application/outbox-handler.registry';
import { TypeOrmInvoiceRepository } from './infra/typeorm-invoice.repository';
import { TypeOrmInvoiceEventRepository } from './infra/typeorm-invoice-event.repository';
import { TypeOrmInvoiceFiscalSnapshotRepository } from './infra/typeorm-invoice-fiscal-snapshot.repository';
import { TypeOrmOutboxRepository } from './infra/typeorm-outbox.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Calculation integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `calculate_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
const meiCompany = randomUUID(),
  regularCompany = randomUUID(),
  otherCompany = randomUUID(),
  futureCompany = randomUUID(),
  blockedCompany = randomUUID();
const tables = [
  'nfse_invoices',
  'nfse_invoice_events',
  'nfse_dps_sequences',
  'outbox_messages',
  'invoice_fiscal_snapshots',
  'invoice_fiscal_reconciliations',
  'credit_transactions',
  'webhook_deliveries',
] as const;
const rtcFixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      '../docs/fiscal/rtc/fixtures/ok-consultoria-2026.json',
    ),
    'utf8',
  ),
) as {
  input: {
    nbsCode: string;
    cst: string;
    classCode: string;
    operationIndicator: string;
  };
};

describePostgres('POST /v1/invoices/calculate with PostgreSQL RLS', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let module: TestingModule;
  let app: INestApplication;
  let intake: InvoiceIntakeService;
  let invoices: TypeOrmInvoiceRepository;
  let snapshots: FiscalSnapshotService;
  let handler: CalculateTaxesHandler;
  let engine: FiscalEngineService;
  const transactions = new TypeOrmTransactionContext();
  const queue = { add: jest.fn() };
  const storage = {
    upload: jest.fn(),
    get: jest.fn(),
    getSignedUrl: jest.fn(),
  };
  const provider = { issue: jest.fn() };
  const lifecycle = { submit: jest.fn(), transition: jest.fn() };
  const certificates = { getActive: jest.fn() };
  const quota = { getStatus: jest.fn() };
  const fakeRtc = new FakeRtcCalculator();
  const config = new ConfigService({
    fiscal: { ibsCbsUnavailableMode: 'block' },
  });

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T15:00:00Z'));
    admin = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(
      `INSERT INTO "${schema}".tenants (id) VALUES ($1), ($2)`,
      [tenantA, tenantB],
    );
    for (const [companyId, tenantId, taxId] of [
      [meiCompany, tenantA, '11222333000181'],
      [regularCompany, tenantA, '11444777000161'],
      [otherCompany, tenantB, '11222333000181'],
      [futureCompany, tenantA, '52998224725'],
      [blockedCompany, tenantA, '11144477735'],
    ]) {
      await admin.query(
        `INSERT INTO "${schema}".nfse_companies (id, tenant_id, legal_name, tax_id, environment, municipality_code, default_service_code) VALUES ($1,$2,'Fixture',$3,'test','3550308','010601')`,
        [companyId, tenantId, taxId],
      );
    }
    const profileRepo = admin.getRepository(CompanyFiscalProfileOrmEntity);
    for (const companyId of [
      meiCompany,
      regularCompany,
      otherCompany,
      futureCompany,
      blockedCompany,
    ]) {
      await profileRepo.insert(
        calculationProfile({
          id: randomUUID(),
          tenantId: companyId === otherCompany ? tenantB : tenantA,
          companyId,
          taxRegime:
            companyId === regularCompany ||
            companyId === otherCompany ||
            companyId === blockedCompany
              ? 'LUCRO_PRESUMIDO'
              : 'MEI',
          validUntil: companyId === futureCompany ? '2026-10-17' : null,
        }),
      );
    }
    await profileRepo.insert(
      calculationProfile({
        id: randomUUID(),
        tenantId: tenantA,
        companyId: futureCompany,
        taxRegime: 'SIMPLES_NACIONAL',
        validFrom: '2026-10-17',
      }),
    );
    for (const companyId of [
      regularCompany,
      otherCompany,
      futureCompany,
      blockedCompany,
    ]) {
      const profile = calculationServiceProfile({
        id: randomUUID(),
        tenantId: companyId === otherCompany ? tenantB : tenantA,
        companyId,
        serviceCode: '010601',
        ...(companyId === blockedCompany
          ? {}
          : {
              nbsCode: rtcFixture.input.nbsCode,
              cst: rtcFixture.input.cst,
              classCode: rtcFixture.input.classCode,
              operationIndicator: rtcFixture.input.operationIndicator,
            }),
      });
      await admin.getRepository(CompanyServiceTaxProfileOrmEntity).insert({
        ...profile,
        withholdingRates: { ...profile.withholdingRates },
      });
    }
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    if (!owner) throw new Error('Migration owner was not returned');
    execFileSync(
      'psql',
      [
        url,
        '-w',
        '-v',
        `runtime_role=${role}`,
        '-v',
        `migration_role=${owner.role}`,
        '-v',
        `app_schema=${schema}`,
        '-f',
        resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
      ],
      { stdio: 'pipe' },
    );
    const runtimeUrl = new URL(url);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    runtime = new DataSource(
      createTypeOrmOptions({
        url: runtimeUrl.toString(),
        schema,
        ssl: false,
        logging: false,
        pool: {
          max: 4,
          min: 0,
          idleTimeoutMs: 30000,
          connectionTimeoutMs: 10000,
          maxLifetimeSeconds: 1800,
        },
      }),
    );
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    const profiles = new CompanyFiscalProfileService(
      new TypeOrmCompanyFiscalProfileRepository(runtime, transactions),
    );
    const services = new CompanyServiceTaxProfileService(
      new TypeOrmCompanyServiceTaxProfileRepository(runtime),
    );
    const companies = new CompanyService(
      new TypeOrmCompanyRepository(runtime.getRepository(CompanyOrmEntity)),
      quota as never,
      new CompanyDomainService(),
      profiles,
    );
    intake = new InvoiceIntakeService(companies, new InvoiceDomainService());
    const helper = new TypeOrmRepositoryHelper(runtime, transactions);
    invoices = new TypeOrmInvoiceRepository(helper);
    snapshots = new FiscalSnapshotService(
      new TypeOrmInvoiceFiscalSnapshotRepository(runtime, transactions),
    );
    module = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        ...FISCAL_ENGINE_INTERNAL_PROVIDERS,
        { provide: InvoiceBatchService, useValue: {} },
        { provide: EmissionRouterService, useValue: {} },
        { provide: InvoiceSubstitutionService, useValue: {} },
        { provide: RTC_MAPPER, useClass: DefaultRtcMapper },
        { provide: ConfigService, useValue: config },
        {
          provide: IFiscalProfileReader,
          useValue: new TypeOrmCompanyFiscalProfileReader(profiles),
        },
        {
          provide: IServiceProfileReader,
          useValue: new TypeOrmServiceProfileReader(services),
        },
        { provide: InvoiceIntakeService, useValue: intake },
        InvoiceCalculationService,
        {
          provide: InvoiceService,
          useValue: new InvoiceService(
            invoices,
            new TypeOrmInvoiceEventRepository(helper),
            storage as never,
            companies,
            certificates as never,
            queue as never,
            lifecycle as never,
            quota as never,
            intake,
            { publish: async () => undefined } as never,
            {
              isSimulated: (environment: string) => environment !== 'live',
            } as never,
          ),
        },
      ],
    })
      .overrideProvider(IFiscalCatalog)
      .useValue({
        lookupServiceCode: () => ({ found: true, version: 'test-only' }),
        validateClassification: async () => ({
          status: 'validated',
          versions: { test: 'test-only' },
        }),
      })
      .overrideProvider(RtcCalculatorPort)
      .useValue(fakeRtc)
      .compile();
    engine = module.get(FiscalEngineService);
    handler = new CalculateTaxesHandler(
      invoices,
      companies,
      profiles,
      engine,
      snapshots,
      new OutboxService(new TypeOrmOutboxRepository(runtime, transactions)),
      lifecycle as never,
      new TypeOrmUnitOfWork(runtime, transactions),
      new OutboxHandlerRegistry(),
    );
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(
      (
        req: Request & {
          authContext?: AuthContext;
          validatedApiKeyId?: string;
        },
        _res: Response,
        next: NextFunction,
      ) => {
        const tenantId = req.headers['x-test-tenant'];
        if (typeof tenantId === 'string') {
          req.authContext = {
            principalType: 'api_key',
            authUserId: '',
            productKey: 'corvo',
            userId: '',
            tenantId,
            activeTenantId: tenantId,
            role: 'developer',
            contextType: 'tenant',
            platformRole: null,
            platformPermissions: [],
            permissions: req.headers['x-test-deny']
              ? []
              : ['nfse.invoices.issue'],
            isPlatformAdmin: false,
            apiKeyEnvironment: 'test',
          };
          req.validatedApiKeyId = 'integration-key';
        }
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    app.useGlobalGuards(
      new TenantContextGuard(),
      new HttpApiRateLimitGuard(
        new RedisRateLimiter({
          getClient: () => {
            throw new Error('offline');
          },
        } as never),
        new Reflector(),
        config,
      ),
      new PermissionGuard(new Reflector(), new RoutePermissionService()),
    );
    await app.init();
  }, 180000);
  afterAll(async () => {
    jest.restoreAllMocks();
    if (app) await app.close();
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  }, 30000);

  const dto = (companyId = meiCompany): CreateInvoiceDto => ({
    companyId,
    amount: 1000,
    discount: 100,
    competenceDate: '2026-10-15',
    service: { code: '010601', description: 'Consulting' },
    ...(companyId === meiCompany
      ? {}
      : {
          customer: {
            name: 'Customer Private Name',
            taxId: '52998224725',
            address: {
              city: 'Sao Paulo',
              state: 'SP',
              municipalityCode: '3550308',
            },
          },
        }),
  });
  const post = (body: CreateInvoiceDto, tenant = tenantA) =>
    request(app.getHttpServer() as Server)
      .post('/v1/invoices/calculate')
      .set('x-test-tenant', tenant)
      .send(body);
  async function counts() {
    const result: Record<string, string> = {};
    for (const table of tables) {
      const [row]: Array<{ count: string }> = await admin.query(
        `SELECT count(*)::text AS count FROM "${schema}"."${table}"`,
      );
      if (!row) throw new Error('Count missing');
      result[table] = row.count;
    }
    return result;
  }
  it('leaves all eight tables unchanged after 20 HTTP requests and never reaches queues, storage, certificates, quota or Sefin', async () => {
    const before = await counts();
    for (let index = 0; index < 20; index++) {
      const response = await post(
        dto([meiCompany, regularCompany, blockedCompany][index % 3]),
      ).expect(200);
      const body = response.body as { data: InvoiceCalculationResponse };
      expect(body.data.status).toBe(index % 3 === 2 ? 'blocked' : 'ready');
      expect(JSON.stringify(body)).not.toContain('52998224725');
      expect(JSON.stringify(body)).not.toContain('Customer Private Name');
    }
    expect(await counts()).toEqual(before);
    for (const mock of [
      queue.add,
      storage.upload,
      storage.get,
      storage.getSignedUrl,
      provider.issue,
      lifecycle.submit,
      lifecycle.transition,
      quota.getStatus,
      certificates.getActive,
    ])
      expect(mock).not.toHaveBeenCalled();
    expect(fakeRtc.calls.length).toBeGreaterThan(0);
  }, 30000);
  it.each([meiCompany, regularCompany])(
    'matches the snapshot persisted by CalculateTaxesHandler for %s',
    async (companyId) => {
      // The existing emission mapper does not preserve discounts; keep emission unchanged.
      const input = { ...dto(companyId), discount: undefined };
      const response = await post(input).expect(200);
      const { data: calculation } = response.body as {
        data: InvoiceCalculationResponse;
      };
      const prepared = await intake.prepare(input, tenantA, 'test');
      const invoice = Invoice.create(
        {
          companyId,
          amount: prepared.normalized.amount,
          discount: prepared.normalized.discount,
          competenceDate: prepared.normalized.competenceDate,
          customer: prepared.normalized.customer,
          service: {
            ...prepared.normalized.service,
            description: prepared.normalized.service.description ?? '',
          },
          environment: 'test',
        },
        tenantA,
      );
      await invoices.insert(invoice, tenantA);
      const message: OutboxMessage = {
        id: randomUUID(),
        tenantId: tenantA,
        environment: 'test',
        type: 'invoice.calculate-taxes',
        aggregateId: invoice.id,
        dedupeKey: invoice.id,
        status: 'claimed',
        availableAt: new Date(),
        leaseUntil: null,
        attempts: 1,
        lastError: null,
        payload: { invoiceId: invoice.id, tenantId: tenantA, companyId },
      };
      await runWithTenant(tenantA, () => handler.handle(message));
      const snapshot = await runWithTenant(tenantA, () =>
        snapshots.findByInvoiceId(invoice.id, tenantA),
      );
      if (!snapshot) throw new Error('Expected persisted worker snapshot');
      expect(calculation.status).toBe('ready');
      expect(calculation.taxes).toEqual(snapshot.result.taxes);
      expect(calculation.withholdings).toEqual(snapshot.result.withholdings);
      expect(calculation.netReceivableAmount).toBe(
        snapshot.result.netReceivableAmount,
      );
      expect(calculation.classification).toEqual(
        snapshot.result.classification,
      );
      expect(calculation.calculation?.rulesVersion).toBe(
        snapshot.result.rulesVersion,
      );
    },
  );
  it('uses the fiscal profile effective at future competence without scheduling', async () => {
    const before = await counts();
    const today = await post(dto(futureCompany)).expect(200);
    const future = await post({
      ...dto(futureCompany),
      competenceDate: '2026-10-18',
    }).expect(200);
    expect(
      (today.body as { data: InvoiceCalculationResponse }).data.taxRegime,
    ).toBe('MEI');
    expect(
      (future.body as { data: InvoiceCalculationResponse }).data.taxRegime,
    ).toBe('SIMPLES_NACIONAL');
    expect(await counts()).toEqual(before);
  });
  it('returns 404 for another tenant company and also hides its profiles through RLS', async () => {
    const response = await post(dto(otherCompany)).expect(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'ERROR_COMPANY_NOT_FOUND',
      requestId: expect.any(String),
    });
    const rows: unknown[] = await runWithTenant(tenantA, () =>
      runtime.query(
        `SELECT id FROM "${schema}".company_fiscal_profiles WHERE company_id = $1`,
        [otherCompany],
      ),
    );
    expect(rows).toEqual([]);
  });
  it('returns 503 with Retry-After for RTC integration failures', async () => {
    const spy = jest.spyOn(fakeRtc, 'calculate').mockResolvedValueOnce(
      err(
        fiscalError({
          code: 'TAX_CALCULATION_UNAVAILABLE',
          category: 'INTEGRATION',
          message: 'Private dependency diagnostics',
          retryable: true,
          details: { retryAfterMs: 2500 },
        }),
      ),
    );
    try {
      const response = await post(dto(regularCompany)).expect(503);
      expect(response.headers['retry-after']).toBe('3');
      expect(response.body).toMatchObject({
        statusCode: 503,
        code: 'ERROR_TAX_CALCULATION_UNAVAILABLE',
        requestId: expect.any(String),
      });
      expect(JSON.stringify(response.body)).not.toContain(
        'Private dependency diagnostics',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('returns a generic 500 for internal fiscal errors', async () => {
    const spy = jest.spyOn(fakeRtc, 'calculate').mockResolvedValueOnce(
      err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          category: 'INTERNAL',
          message: 'Private internal diagnostics',
        }),
      ),
    );
    try {
      const response = await post(dto(regularCompany)).expect(500);
      expect(response.body).toMatchObject({
        statusCode: 500,
        code: 'ERROR_INTERNAL',
        message: 'Internal server error',
      });
      expect(JSON.stringify(response.body)).not.toContain(
        'Private internal diagnostics',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('requires authenticated context and the existing issue permission', async () => {
    await request(app.getHttpServer() as Server)
      .post('/v1/invoices/calculate')
      .send(dto())
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/v1/invoices/calculate')
      .set('x-test-tenant', tenantA)
      .set('x-test-deny', '1')
      .send(dto())
      .expect(403);
  });
  it('repeats the same result except for trace durations', async () => {
    const first = (await post(dto(regularCompany)).expect(200)).body as {
      data: InvoiceCalculationResponse;
    };
    const second = (await post(dto(regularCompany)).expect(200)).body as {
      data: InvoiceCalculationResponse;
    };
    const omitDuration = (response: InvoiceCalculationResponse) => ({
      ...response,
      trace: response.trace.map(
        ({ durationMs: _durationMs, ...trace }) => trace,
      ),
    });
    expect(omitDuration(first.data)).toEqual(omitDuration(second.data));
  });
});
