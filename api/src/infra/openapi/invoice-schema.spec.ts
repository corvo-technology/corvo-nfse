import { InvoiceCalculationService } from '@/modules/invoice/application/fiscal/invoice-calculation.service';
import { InvoiceSubstitutionService } from '@/modules/invoice/application/invoice-substitution.service';
import { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { InvoiceController } from '@/modules/invoice/http/invoice.controller';
import { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { ExecutionEnvironmentGuard } from '@/modules/auth/execution-environment.guard';
import { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import { setupOpenApi } from './setup';

it('documents the actual 202 invoice response with nullable scheduledFor', async () => {
  const module = await Test.createTestingModule({
    controllers: [InvoiceController],
    providers: [
      { provide: InvoiceService, useValue: {} },
      { provide: InvoiceBatchService, useValue: {} },
      { provide: EmissionRouterService, useValue: {} },
      { provide: InvoiceSubstitutionService, useValue: {} },
      { provide: InvoiceCalculationService, useValue: {} },
    ],
  })
    .overrideGuard(ExecutionEnvironmentGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication();
  const setup = jest
    .spyOn(SwaggerModule, 'setup')
    .mockImplementation(() => undefined);
  try {
    await app.init();
    setupOpenApi(
      app,
      new ConfigService({
        openApi: { enabled: true, path: 'docs', jsonPath: 'docs.json' },
        app: { version: 'test', apiPrefix: 'v1' },
      }),
    );
    const documentOrFactory = setup.mock.calls[0]?.[2];
    const document =
      typeof documentOrFactory === 'function'
        ? documentOrFactory()
        : documentOrFactory;
    expect(document?.components?.schemas?.InvoiceResponseDto).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          scheduledFor: expect.objectContaining({
            type: 'string',
            format: 'date-time',
            nullable: true,
          }),
          cancellationRequestedAt: expect.objectContaining({
            type: 'string',
            format: 'date-time',
            nullable: true,
          }),
        }),
      }),
    );
    const cancelResponses =
      document?.paths['/invoices/{id}/cancel']?.post?.responses ?? {};
    expect(Object.keys(cancelResponses)).toEqual(
      expect.arrayContaining(['200', '202']),
    );
    const cancelOp = document?.paths['/invoices/{id}/cancel']?.post;
    expect(cancelOp?.summary).toContain('processing');
    expect(cancelOp?.description).toContain('cancellationRequestedAt');
    expect(cancelOp?.description).toContain('does not refund');
    const batchOp = document?.paths['/invoices/batches']?.post;
    expect(batchOp?.responses['202']).toBeDefined();
    expect(batchOp?.description).toContain('single transaction');
    expect(document?.components?.schemas?.BatchInvoiceItemDto).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          idempotencyKey: expect.any(Object),
        }),
      }),
    );
    expect(document?.components?.schemas?.InvoiceBatchSummaryDto).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          results: expect.any(Object),
          accepted: expect.any(Object),
        }),
      }),
    );
    expect(
      document?.paths['/invoices/calculate']?.post?.responses['200'],
    ).toBeDefined();
    expect(
      document?.components?.schemas?.InvoiceCalculationResponseDto,
    ).toMatchObject({
      properties: {
        preEmission: { enum: [true] },
        taxes: expect.any(Object),
        pendingFields: expect.any(Object),
        blocking: expect.any(Object),
        trace: expect.any(Object),
      },
    });
    expect(document?.paths['/invoices']?.post?.responses['202']).toEqual(
      expect.objectContaining({
        content: {
          'application/json': {
            schema: expect.objectContaining({
              properties: {
                data: { $ref: '#/components/schemas/InvoiceResponseDto' },
              },
            }),
          },
        },
      }),
    );
  } finally {
    setup.mockRestore();
    await app.close();
  }
});
