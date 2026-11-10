import { plainToInstance } from 'class-transformer';
import { CreateInvoiceDto } from '../http/invoice.dto';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { InvoiceDomainService } from './invoice-domain.service';

function validDto(overrides: Record<string, unknown> = {}) {
  return {
    companyId: '01927de2-1234-7890-abcd-ef0123456789',
    customer: {
      name: 'Cliente',
      taxId: '529.982.247-25',
      email: 'cliente@example.com',
    },
    service: {
      code: '010101',
      municipalityCode: '3550308',
      description: 'Serviço',
    },
    amount: 100.5,
    competenceDate: '2026-01-01',
    options: { email: { send: true } },
    ...overrides,
  };
}

describe('InvoiceDomainService', () => {
  let service: InvoiceDomainService;

  beforeEach(() => {
    service = new InvoiceDomainService();
  });

  describe('normalizeAndValidate', () => {
    const defaults = { code: '010101', municipalityCode: '3550308' };

    it('requires the service object even with company defaults', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({ service: undefined }) as any,
          'test',
          defaults,
        ),
      ).toThrow(FiscalValidationError);
    });

    it('inherits company fiscal defaults', () => {
      const result = service.normalizeAndValidate(
        validDto({ service: { description: 'Serviço' } }),
        'test',
        defaults,
      );
      expect(result.service).toEqual({ ...defaults, description: 'Serviço' });
    });

    it('allows overriding code and municipality for one invoice', () => {
      const result = service.normalizeAndValidate(
        validDto({ service: { code: '010201', municipalityCode: '3170206' } }),
        'test',
        defaults,
      );
      expect(result.service.code).toBe('010201');
      expect(result.service.municipalityCode).toBe('3170206');
    });

    it.each([null, '', '06990', 'invalid'])(
      'does not replace invalid explicit service code %p with defaults',
      (code) => {
        expect(() =>
          service.normalizeAndValidate(
            validDto({ service: { code } }) as any,
            'test',
            defaults,
          ),
        ).toThrow(FiscalValidationError);
      },
    );

    it.each([null, '', '123', 'invalid'])(
      'does not replace invalid explicit municipality %p with defaults',
      (municipalityCode) => {
        expect(() =>
          service.normalizeAndValidate(
            validDto({ service: { municipalityCode } }) as any,
            'test',
            defaults,
          ),
        ).toThrow(FiscalValidationError);
      },
    );

    it('reports missing code when neither the invoice nor company provides it', () => {
      try {
        service.normalizeAndValidate(validDto({ service: {} }), 'test', {
          municipalityCode: defaults.municipalityCode,
        });
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        expect((error as FiscalValidationError).issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'service.code',
              code: 'required',
            }),
          ]),
        );
      }
    });
    it('normalizes valid input', () => {
      const result = service.normalizeAndValidate(validDto(), 'live');
      expect(result.customer?.taxId).toBe('52998224725');
      expect(result.customer?.taxIdKind).toBe('CPF');
      expect(result.amount).toBe(100.5);
      expect(result.service.code).toBe('010101');
    });

    it('parses CNPJ correctly', () => {
      const result = service.normalizeAndValidate(
        validDto({
          customer: {
            name: 'X',
            taxId: '11.222.333/0001-81',
            email: 'x@example.com',
          },
        }),
        'test',
      );
      expect(result.customer?.taxId).toBe('11222333000181');
      expect(result.customer?.taxIdKind).toBe('CNPJ');
    });

    it('normalizes address state to UF', () => {
      const result = service.normalizeAndValidate(
        validDto({
          customer: {
            name: 'X',
            taxId: '529.982.247-25',
            email: 'x@example.com',
            address: { city: 'Sao Paulo', state: 'sp' },
          },
        }),
        'test',
      );
      expect(result.customer?.address.state).toBe('SP');
    });

    it('throws FiscalValidationError for invalid taxId', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({ customer: { name: 'X', taxId: '00000000000' } }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for incomplete address (city without state)', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({
            customer: {
              name: 'X',
              taxId: '529.982.247-25',
              address: { city: 'Sao Paulo' },
            },
          }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for incomplete address (state without city)', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({
            customer: {
              name: 'X',
              taxId: '529.982.247-25',
              address: { state: 'SP' },
            },
          }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for invalid service.code (not 6 digits)', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({ service: { code: '12345' } }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
      expect(() =>
        service.normalizeAndValidate(
          validDto({ service: { code: '1234567' } }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for invalid municipalityCode (not 7 digits)', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({
            service: { code: '010101', municipalityCode: '530010' },
          }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for amount with more than 2 decimal places', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({ amount: 100.999 }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for negative amount', () => {
      expect(() =>
        service.normalizeAndValidate(validDto({ amount: -10 }) as any, 'test'),
      ).toThrow(FiscalValidationError);
    });

    it('throws for amount exceeding ceiling', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({ amount: 10000000000 }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for future competenceDate', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(() =>
        service.normalizeAndValidate(
          validDto({ competenceDate: future.toISOString() }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('does not throw for missing email when email.send=false', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({ options: { email: { send: false } } }) as any,
          'test',
        ),
      ).not.toThrow();
    });

    it('throws for missing email when email.send=true', () => {
      expect(() =>
        service.normalizeAndValidate(
          validDto({
            customer: { name: 'X', taxId: '529.982.247-25' },
            options: { email: { send: true } },
          }) as any,
          'test',
        ),
      ).toThrow(FiscalValidationError);
    });

    it('groups all issues in FiscalValidationError', () => {
      try {
        service.normalizeAndValidate({} as any, 'test');
      } catch (e) {
        expect(e).toBeInstanceOf(FiscalValidationError);
        expect((e as FiscalValidationError).issues.length).toBeGreaterThan(1);
      }
    });

    it('does not echo customer-sent taxId in error message', () => {
      try {
        service.normalizeAndValidate(
          validDto({
            customer: { name: 'X', taxId: '11.222.333/0001-80' },
          }),
          'test',
        );
      } catch (e) {
        expect(e).toBeInstanceOf(FiscalValidationError);
        expect(
          JSON.stringify((e as FiscalValidationError).issues),
        ).not.toContain('11.222.333');
      }
    });
  });
});

describe('InvoiceDomainService — optional customer, discount and fiscal input', () => {
  let service: InvoiceDomainService;
  const defaults = { code: '010101', municipalityCode: '3550308' };

  beforeEach(() => {
    service = new InvoiceDomainService();
  });

  describe('customer opcional', () => {
    it('treats a missing customer as consumer with customer null', () => {
      const result = service.normalizeAndValidate(
        validDto({ customer: undefined, options: {} }),
        'test',
        defaults,
      );
      expect(result.customer).toBeNull();
    });

    it('treats an empty customer object as consumer with customer null', () => {
      const result = service.normalizeAndValidate(
        validDto({ customer: {}, options: {} }),
        'test',
        defaults,
      );
      expect(result.customer).toBeNull();
    });

    it('fills only absent fields for a partial customer with taxId', () => {
      const result = service.normalizeAndValidate(
        validDto({
          customer: { taxId: '529.982.247-25' },
          options: {},
        }),
        'test',
        defaults,
      );
      expect(result.customer).toMatchObject({
        name: 'Consumidor',
        taxId: '52998224725',
        taxIdKind: 'CPF',
        address: { city: 'SIM', state: 'SS' },
      });
    });

    it.each([
      { name: 'Ana' },
      { email: 'ana@example.com' },
      { address: { city: 'São Paulo', state: 'SP' } },
    ])('requires the taxId when a customer is sent (%o)', (customer) => {
      try {
        service.normalizeAndValidate(
          validDto({ customer, options: {} }),
          'test',
          defaults,
        );
        throw new Error('expected a FiscalValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        expect((error as FiscalValidationError).issues).toContainEqual(
          expect.objectContaining({
            field: 'customer.taxId',
            code: 'required',
          }),
        );
      }
    });

    it('keeps the name optional when the taxId is present', () => {
      const result = service.normalizeAndValidate(
        validDto({ customer: { taxId: '529.982.247-25' }, options: {} }),
        'test',
        defaults,
      );
      expect(result.customer?.taxId).toBe('52998224725');
      expect(result.customer?.taxIdKind).toBe('CPF');
    });

    it('still rejects an invalid taxId when present', () => {
      try {
        service.normalizeAndValidate(
          validDto({ customer: { taxId: '00000000000' }, options: {} }),
          'test',
          defaults,
        );
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        expect((error as FiscalValidationError).issues).toContainEqual(
          expect.objectContaining({
            field: 'customer.taxId',
            code: 'invalid_tax_id',
          }),
        );
      }
    });
  });

  describe('discount', () => {
    it('accepts a discount up to the gross amount', () => {
      const result = service.normalizeAndValidate(
        validDto({ amount: 1000, discount: 100.25 }),
        'test',
        defaults,
      );
      expect(result.discount).toBe(100.25);
    });

    it('accepts a discount equal to the gross amount', () => {
      const result = service.normalizeAndValidate(
        validDto({ amount: 1000, discount: 1000 }),
        'test',
        defaults,
      );
      expect(result.discount).toBe(1000);
    });

    it('rejects a negative discount with out_of_range', () => {
      try {
        service.normalizeAndValidate(
          validDto({ amount: 1000, discount: -1 }),
          'test',
          defaults,
        );
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        expect((error as FiscalValidationError).issues).toContainEqual(
          expect.objectContaining({
            field: 'discount',
            code: 'out_of_range',
          }),
        );
      }
    });

    it('rejects a discount greater than the gross amount with out_of_range', () => {
      try {
        service.normalizeAndValidate(
          validDto({ amount: 1000, discount: 1000.01 }),
          'test',
          defaults,
        );
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        expect((error as FiscalValidationError).issues).toContainEqual(
          expect.objectContaining({
            field: 'discount',
            code: 'out_of_range',
          }),
        );
      }
    });

    it('rejects a discount with more than two decimal places', () => {
      try {
        service.normalizeAndValidate(
          validDto({ amount: 1000, discount: 100.999 }),
          'test',
          defaults,
        );
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        expect((error as FiscalValidationError).issues).toContainEqual(
          expect.objectContaining({
            field: 'discount',
            code: 'invalid_decimal_places',
          }),
        );
      }
    });
  });

  describe('deduction', () => {
    const issuesOf = (dto: ReturnType<typeof validDto>) => {
      try {
        service.normalizeAndValidate(dto, 'test', defaults);
      } catch (error) {
        expect(error).toBeInstanceOf(FiscalValidationError);
        return (error as FiscalValidationError).issues;
      }
      throw new Error('Expected validation failure');
    };

    it('accepts a deduction below the amount and normalizes it', () => {
      const result = service.normalizeAndValidate(
        validDto({ amount: 100, deduction: 40 }),
        'test',
        defaults,
      );
      expect(result.deduction).toBe(40);
    });

    it('accepts a deduction below the amount minus the discount', () => {
      const result = service.normalizeAndValidate(
        validDto({ amount: 100, discount: 10, deduction: 89.99 }),
        'test',
        defaults,
      );
      expect(result.deduction).toBe(89.99);
    });

    it('treats a zero deduction as no deduction', () => {
      const result = service.normalizeAndValidate(
        validDto({ amount: 100, deduction: 0 }),
        'test',
        defaults,
      );
      expect(result.deduction).toBeUndefined();
    });

    it('leaves the deduction undefined when it is omitted', () => {
      const result = service.normalizeAndValidate(
        validDto({ amount: 100 }),
        'test',
        defaults,
      );
      expect(result.deduction).toBeUndefined();
    });

    it('rejects a negative deduction with out_of_range', () => {
      expect(issuesOf(validDto({ amount: 100, deduction: -1 }))).toContainEqual(
        expect.objectContaining({ field: 'deduction', code: 'out_of_range' }),
      );
    });

    it('rejects a deduction equal to the amount', () => {
      expect(
        issuesOf(validDto({ amount: 100, deduction: 100 })),
      ).toContainEqual(
        expect.objectContaining({ field: 'deduction', code: 'out_of_range' }),
      );
    });

    it('rejects a deduction that leaves nothing after the discount', () => {
      expect(
        issuesOf(validDto({ amount: 100, discount: 10, deduction: 90 })),
      ).toContainEqual(
        expect.objectContaining({ field: 'deduction', code: 'out_of_range' }),
      );
    });

    it('rejects a deduction with more than two decimal places', () => {
      expect(
        issuesOf(validDto({ amount: 100, deduction: 10.999 })),
      ).toContainEqual(
        expect.objectContaining({
          field: 'deduction',
          code: 'invalid_decimal_places',
        }),
      );
    });
  });

  describe('service.fiscal passthrough', () => {
    it('passes fiscal input and serviceProfileId through without interpretation', () => {
      const fiscal = {
        nbsCode: '010101001',
        cst: '001',
        classCode: '010601',
        operationIndicator: '000001',
      };
      const serviceProfileId = '01927de2-1234-7890-abcd-ef0123456789';
      const result = service.normalizeAndValidate(
        validDto({
          service: {
            code: '010101',
            municipalityCode: '3550308',
            description: 'Serviço',
            fiscal,
            serviceProfileId,
          },
        }),
        'test',
        defaults,
      );
      expect(result.service.fiscal).toEqual(fiscal);
      expect(result.service.serviceProfileId).toBe(serviceProfileId);
    });

    it('leaves fiscal undefined when not provided', () => {
      const result = service.normalizeAndValidate(validDto(), 'test', defaults);
      expect(result.service.fiscal).toBeUndefined();
      expect(result.service.serviceProfileId).toBeUndefined();
    });
  });
});

describe('SCHEDULE calendar days', () => {
  const input = (date: string, type = 'SCHEDULE') => ({
    ...plainToInstance(
      CreateInvoiceDto,
      validDto({ competenceDate: date, options: { type } }),
    ),
    companyId: '01927de2-1234-7890-abcd-ef0123456789',
  });
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-10-13T12:00:00Z')),
  );
  afterEach(() => jest.useRealTimers());

  it('preserves IMMEDIATE future-date rejection', () => {
    expect(() =>
      new InvoiceDomainService().normalizeAndValidate(
        input('2026-10-14', 'IMMEDIATE'),
        'test',
      ),
    ).toThrow(FiscalValidationError);
  });
  it('releases tomorrow at local midnight', () => {
    expect(
      new InvoiceDomainService()
        .normalizeAndValidate(input('2026-10-14'), 'test')
        .scheduledFor?.toISOString(),
    ).toBe('2026-10-14T12:00:00.000Z');
  });
  it.each(['2026-10-13', '2026-10-12'])(
    'treats today/past %s as immediate',
    (date) => {
      expect(
        new InvoiceDomainService().normalizeAndValidate(input(date), 'test')
          .scheduledFor,
      ).toBeUndefined();
    },
  );
  it('schedules the next local day during the UTC/local boundary', () => {
    jest.setSystemTime(new Date('2026-10-13T02:00:00Z'));
    expect(
      new InvoiceDomainService()
        .normalizeAndValidate(input('2026-10-13'), 'test')
        .scheduledFor?.toISOString(),
    ).toBe('2026-10-13T12:00:00.000Z');
    expect(
      new InvoiceDomainService().normalizeAndValidate(
        input('2026-10-12'),
        'test',
      ).scheduledFor,
    ).toBeUndefined();
  });
  it('accepts the inclusive default 15 calendar-day horizon', () => {
    expect(
      new InvoiceDomainService()
        .normalizeAndValidate(input('2026-10-28'), 'test')
        .scheduledFor?.toISOString(),
    ).toBe('2026-10-28T12:00:00.000Z');
  });
  it.each([
    [15, '2026-10-29'],
    [30, '2026-11-13'],
  ])('rejects beyond the %s day horizon', (days, date) => {
    try {
      new InvoiceDomainService(days).normalizeAndValidate(input(date), 'test');
      throw new Error('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FiscalValidationError);
      if (!(error instanceof FiscalValidationError)) throw error;
      expect(error.issues).toContainEqual(
        expect.objectContaining({
          field: 'competenceDate',
          code: 'schedule_horizon_exceeded',
        }),
      );
    }
  });
  it('accepts the exact configured calendar horizon at the UTC boundary', () => {
    jest.setSystemTime(new Date('2026-10-13T02:00:00Z'));
    expect(
      new InvoiceDomainService(30)
        .normalizeAndValidate(input('2026-11-11'), 'test')
        .scheduledFor?.toISOString(),
    ).toBe('2026-11-11T12:00:00.000Z');
  });
});

describe('InvoiceDomainService complementary info', () => {
  const service = new InvoiceDomainService();
  const issuesOf = (overrides: Record<string, unknown>) => {
    try {
      service.normalizeAndValidate(validDto(overrides), 'live');
    } catch (error) {
      if (error instanceof FiscalValidationError) return error.issues;
      throw error;
    }
    return [];
  };

  it('keeps the purchase order and the notes, trimmed', () => {
    const result = service.normalizeAndValidate(
      validDto({
        purchaseOrder: '  PO-4521 ',
        notes: ' Ref. contrato 12\nParcela 2 de 3 ',
      }),
      'live',
    );
    expect(result.service.purchaseOrder).toBe('PO-4521');
    expect(result.service.notes).toBe('Ref. contrato 12\nParcela 2 de 3');
  });

  it('drops blank values, so the group never reaches the DPS empty', () => {
    const result = service.normalizeAndValidate(
      validDto({ purchaseOrder: '   ', notes: '' }),
      'live',
    );
    expect(result.service.purchaseOrder).toBeUndefined();
    expect(result.service.notes).toBeUndefined();
  });

  it('rejects values above the DPS limits (xPed 60, xInfComp 2000)', () => {
    expect(issuesOf({ purchaseOrder: 'x'.repeat(61) })).toEqual([
      expect.objectContaining({ field: 'purchaseOrder', code: 'too_long' }),
    ]);
    expect(issuesOf({ notes: 'x'.repeat(2001) })).toEqual([
      expect.objectContaining({ field: 'notes', code: 'too_long' }),
    ]);
    expect(
      issuesOf({ purchaseOrder: 'x'.repeat(60), notes: 'x'.repeat(2000) }),
    ).toEqual([]);
  });

  it('rejects control characters and a line break in the purchase order', () => {
    expect(issuesOf({ purchaseOrder: 'PO\n4521' })).toEqual([
      expect.objectContaining({ field: 'purchaseOrder', code: 'invalid' }),
    ]);
    expect(issuesOf({ notes: 'texto\u0000oculto' })).toEqual([
      expect.objectContaining({ field: 'notes', code: 'invalid' }),
    ]);
  });

  it('rejects a value that is not text', () => {
    expect(issuesOf({ purchaseOrder: 4521 })).toEqual([
      expect.objectContaining({ field: 'purchaseOrder', code: 'invalid_type' }),
    ]);
  });
});
