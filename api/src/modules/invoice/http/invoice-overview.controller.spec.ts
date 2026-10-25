import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { InvoiceOverviewController } from './invoice-overview.controller';
import { InvoiceOverviewService } from '../application/invoice-overview.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from '../application/invoice.service';
import { InvoiceBatchService } from '../application/invoice-batch.service';
import { InvoiceCalculationService } from '../application/fiscal/invoice-calculation.service';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';

describe('Invoice overview HTTP contract', () => {
  let app: INestApplication;
  const get = jest
    .fn()
    .mockResolvedValue({
      counts: { authorized: 1201 },
      dailyActivity: [],
      recentInvoices: [],
    });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InvoiceOverviewController, InvoiceController],
      providers: [
        { provide: InvoiceOverviewService, useValue: { get } },
        { provide: InvoiceService, useValue: {} },
        { provide: InvoiceBatchService, useValue: {} },
        { provide: InvoiceCalculationService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req, _res, next) => {
      req.authContext = { activeTenantId: 'tenant-a' };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => app.close());

  it('routes overview before :id, defaults to 7d and keeps the response envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/invoices/overview')
      .expect(200);
    expect(response.body.data.counts.authorized).toBe(1201);
    expect(get).toHaveBeenLastCalledWith('tenant-a', 'test', '7d');
  });
  it('uses the selected execution environment and validates periods', async () => {
    await request(app.getHttpServer())
      .get('/invoices/overview?period=30d')
      .set('X-Corvo-Environment', 'live')
      .expect(200);
    expect(get).toHaveBeenLastCalledWith('tenant-a', 'live', '30d');
    await request(app.getHttpServer())
      .get('/invoices/overview?period=90d')
      .expect(400);
    await request(app.getHttpServer())
      .get('/invoices/overview?period=')
      .expect(400);
    await request(app.getHttpServer())
      .get('/invoices/overview')
      .set('X-Corvo-Environment', 'invalid')
      .expect(400);
  });
  it('requires invoice viewing and documents the aggregated response', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_TENANT_PERMISSION,
        InvoiceOverviewController.prototype.get,
      ),
    ).toBe('nfse.invoices.view');
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(doc.paths['/invoices/overview'].get?.responses['200']).toBeDefined();
    expect(
      doc.components?.schemas?.InvoiceOverviewResponseDto.properties
        ?.recentInvoices,
    ).toMatchObject({ maxItems: 5 });
  });
});
