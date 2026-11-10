import { Test } from '@nestjs/testing';
import { InvoiceSubstitutionService } from '@/modules/invoice/application/invoice-substitution.service';
import { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { fiscalError } from '../domain/fiscal/fiscal-error';
import { InvoiceCalculationService } from '../application/fiscal/invoice-calculation.service';
import { InvoiceService } from '../application/invoice.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceBatchService } from '../application/invoice-batch.service';

describe('InvoiceController.calculate', () => {
  const request = {
    authContext: { activeTenantId: 'tenant', executionEnvironment: 'test' },
  } as RequestWithAuthContext;
  const dto = {
    companyId: 'company',
    amount: 50,
    service: {},
    competenceDate: '2026-01-01',
  };
  it('is always registered and usable with no configuration service', async () => {
    const calculate = jest
      .fn()
      .mockResolvedValue({ response: { status: 'ready', preEmission: true } });
    const module = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        { provide: InvoiceService, useValue: {} },
        { provide: InvoiceBatchService, useValue: {} },
        { provide: EmissionRouterService, useValue: {} },
        { provide: InvoiceSubstitutionService, useValue: {} },
        { provide: InvoiceCalculationService, useValue: { calculate } },
      ],
    }).compile();
    const controller = module.get(InvoiceController);
    const setHeader = jest.fn();
    expect(
      await controller.calculate(dto, request, {
        setHeader,
      } as unknown as Response),
    ).toEqual({ data: { status: 'ready', preEmission: true } });
    expect(calculate).toHaveBeenCalledWith(dto, 'tenant', 'test');
    expect(Reflect.getMetadata(PATH_METADATA, controller.calculate)).toBe(
      'calculate',
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.calculate)).toBe(
      200,
    );
    await module.close();
  });
  it('sets Retry-After before throwing the dependency error for 503', async () => {
    const error = fiscalError({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      message: 'RTC down',
      category: 'INTEGRATION',
      details: { retryAfterMs: 2500 },
    });
    const controller = new InvoiceController(
      {} as never,
      { calculate: async () => ({ httpError: error }) } as never,
      {} as never,
    );
    const setHeader = jest.fn();
    await expect(
      controller.calculate(dto, request, { setHeader } as unknown as Response),
    ).rejects.toMatchObject({ kind: 'dependency', retryable: true });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 3);
  });
});
