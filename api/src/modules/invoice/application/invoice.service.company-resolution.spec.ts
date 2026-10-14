import { BadRequestException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';
import type { CreateInvoiceDto } from '../http/invoice.dto';
import type { AuthContext } from '@/modules/auth/auth-context';

const STOP = new Error('stop after company resolution');

describe('InvoiceService.emit company resolution', () => {
  const authContext = { executionEnvironment: 'test' } as AuthContext;
  let companyService: { findByTaxId: jest.Mock; findById: jest.Mock };
  let invoiceDomain: { normalizeAndValidate: jest.Mock };
  let service: InvoiceService;

  const dto = (extra: Partial<CreateInvoiceDto>): CreateInvoiceDto => ({
    customer: { name: 'C', taxId: '1' },
    service: { code: '010101' },
    amount: 10,
    competenceDate: '2026-10-10',
    ...extra,
  });

  beforeEach(() => {
    companyService = {
      findByTaxId: jest.fn(),
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'c-1', municipalityCode: '3550308' }),
    };
    invoiceDomain = {
      normalizeAndValidate: jest.fn().mockImplementation(() => {
        throw STOP;
      }),
    };
    service = new InvoiceService(
      {} as any,
      {} as any,
      {} as any,
      companyService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      invoiceDomain as never,
    );
  });

  it('loads companyId with tenant and environment', async () => {
    await expect(
      service.emit(dto({ companyId: 'c-1' }), 't-1', authContext),
    ).rejects.toBe(STOP);

    expect(companyService.findByTaxId).not.toHaveBeenCalled();
    expect(companyService.findById).toHaveBeenCalledWith('c-1', 't-1', 'test');
    expect(invoiceDomain.normalizeAndValidate).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c-1' }),
      'test',
      { code: undefined, municipalityCode: '3550308' },
    );
  });

  it('resolves companyTaxId to the company id', async () => {
    companyService.findByTaxId.mockResolvedValue({
      id: 'c-9',
      municipalityCode: '3550308',
    });

    await expect(
      service.emit(
        dto({ companyTaxId: '11.222.333/0001-81' }),
        't-1',
        authContext,
      ),
    ).rejects.toBe(STOP);

    expect(companyService.findByTaxId).toHaveBeenCalledWith(
      '11.222.333/0001-81',
      't-1',
      'test',
    );
    expect(invoiceDomain.normalizeAndValidate).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c-9' }),
      'test',
      { code: undefined, municipalityCode: '3550308' },
    );
  });

  it('propagates CompanyNotFoundError when the CNPJ is unknown', async () => {
    companyService.findByTaxId.mockRejectedValue(
      new CompanyNotFoundError('11222333000181'),
    );

    await expect(
      service.emit(dto({ companyTaxId: '11222333000181' }), 't-1', authContext),
    ).rejects.toThrow(CompanyNotFoundError);
  });

  it('prefers companyId when both are sent', async () => {
    await expect(
      service.emit(
        dto({ companyId: 'c-1', companyTaxId: '11222333000181' }),
        't-1',
        authContext,
      ),
    ).rejects.toBe(STOP);

    expect(companyService.findByTaxId).not.toHaveBeenCalled();
    expect(companyService.findById).toHaveBeenCalledWith('c-1', 't-1', 'test');
    expect(invoiceDomain.normalizeAndValidate).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c-1' }),
      'test',
      { code: undefined, municipalityCode: '3550308' },
    );
  });

  it('rejects when neither is sent', async () => {
    await expect(service.emit(dto({}), 't-1', authContext)).rejects.toThrow(
      BadRequestException,
    );
  });
});
