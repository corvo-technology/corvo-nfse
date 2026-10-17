import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { InvoiceController } from '@/modules/invoice/http/invoice.controller';
import { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { ExecutionEnvironmentGuard } from '@/modules/auth/execution-environment.guard';
import { setupOpenApi } from './setup';

it('documents the actual 202 invoice data.props response with nullable scheduledFor', async () => {
  const module = await Test.createTestingModule({
    controllers: [InvoiceController],
    providers: [{ provide: InvoiceService, useValue: {} }],
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
        }),
      }),
    );
    const cancelResponses =
      document?.paths['/invoices/{id}/cancel']?.post?.responses ?? {};
    expect(Object.keys(cancelResponses)).toEqual(
      expect.arrayContaining(['200', '202']),
    );
    expect(document?.paths['/invoices']?.post?.responses['202']).toEqual(
      expect.objectContaining({
        content: {
          'application/json': {
            schema: expect.objectContaining({
              properties: {
                data: {
                  type: 'object',
                  properties: {
                    props: { $ref: '#/components/schemas/InvoiceResponseDto' },
                  },
                },
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
