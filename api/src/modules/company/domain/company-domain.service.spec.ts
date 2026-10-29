import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { CompanyDomainService } from './company-domain.service';

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    legalName: 'Acme Corp',
    taxId: '11.222.333/0001-81',
    taxRegime: 'Simples Nacional' as const,
    simplesRate: '6.54',
    municipalityCode: '3550308',
    ...overrides,
  };
}

describe('CompanyDomainService', () => {
  let service: CompanyDomainService;

  beforeEach(() => {
    service = new CompanyDomainService();
  });

  describe('validateAndNormalizeCreate', () => {
    it('requires the rate of a Simples Nacional company', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ simplesRate: undefined }) as any,
        ),
      ).toThrow(FiscalValidationError);
    });

    it.each(['abc', '6,54', '6.543', '100.01', '-1'])(
      'rejects the invalid Simples rate %p',
      (simplesRate) => {
        expect(() =>
          service.validateAndNormalizeCreate(
            validCreate({ simplesRate }) as any,
          ),
        ).toThrow(FiscalValidationError);
      },
    );

    it('rejects an ISS rate outside the Simples bracket range', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ simplesIssRate: '9.00' }) as any,
        ),
      ).toThrow(FiscalValidationError);
    });

    it('does not ask a MEI for the rates and ignores them when sent', () => {
      const normalized = service.validateAndNormalizeCreate(
        validCreate({
          taxRegime: 'MEI',
          simplesRate: undefined,
        }),
      );
      expect(normalized.simplesRate).toBeUndefined();
      const sent = service.validateAndNormalizeCreate(
        validCreate({
          taxRegime: 'MEI',
          simplesRate: '6.54',
          simplesIssRate: '2.01',
        }),
      );
      expect(sent.simplesRate).toBeUndefined();
      expect(sent.simplesIssRate).toBeUndefined();
    });

    it.each([undefined, null, '', '123', 'abcdefg'])(
      'rejects missing or invalid municipality %p',
      (municipalityCode) => {
        expect(() =>
          service.validateAndNormalizeCreate(
            validCreate({ municipalityCode }) as any,
          ),
        ).toThrow(FiscalValidationError);
      },
    );

    it('accepts a live company without a municipal registration', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ environment: 'live' }),
        ),
      ).not.toThrow();
    });

    it('still rejects a blank municipal registration', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ environment: 'live', municipalReg: '   ' }),
        ),
      ).toThrow(FiscalValidationError);
    });

    it('normalizes a valid default and preserves null when removing it', () => {
      expect(
        service.validateAndNormalizeCreate(
          validCreate({ defaultServiceCode: '010101' }),
        ).defaultServiceCode,
      ).toBe('010101');
      expect(
        service.validateAndNormalizeUpdate({ defaultServiceCode: null })
          .defaultServiceCode,
      ).toBeNull();
      expect(() =>
        service.validateAndNormalizeUpdate({ defaultServiceCode: '' }),
      ).toThrow(FiscalValidationError);
    });

    it('rejects invalid default service code', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ defaultServiceCode: '06990' }),
        ),
      ).toThrow(FiscalValidationError);
    });

    it.each([null, '', '123'])(
      'rejects clearing or invalidating municipality in updates: %p',
      (municipalityCode) => {
        expect(() =>
          service.validateAndNormalizeUpdate({ municipalityCode } as any),
        ).toThrow(FiscalValidationError);
      },
    );
    it('normalizes valid CNPJ', () => {
      const result = service.validateAndNormalizeCreate(
        validCreate({ taxId: '11.222.333/0001-81' }),
      );
      expect(result.taxId).toBe('11222333000181');
    });

    it('normalizes address state to UF', () => {
      const result = service.validateAndNormalizeCreate(
        validCreate({ address: { city: 'Brasilia', state: 'df' } }),
      );
      expect(result.address!.state).toBe('DF');
    });

    it('normalizes zip to digits only', () => {
      const result = service.validateAndNormalizeCreate(
        validCreate({ address: { zip: '70040-010' } }),
      );
      expect(result.address!.zip).toBe('70040010');
    });

    it('throws FiscalValidationError for invalid CNPJ digit', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ taxId: '11.222.333/0001-80' }),
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for blank municipalReg', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ municipalReg: '   ' }),
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for invalid address.state', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ address: { state: 'XX' } }),
        ),
      ).toThrow(FiscalValidationError);
    });

    it('throws for invalid address.zip', () => {
      expect(() =>
        service.validateAndNormalizeCreate(
          validCreate({ address: { zip: '123' } }),
        ),
      ).toThrow(FiscalValidationError);
    });

    it('groups all issues', () => {
      try {
        service.validateAndNormalizeCreate({
          taxId: '11.222.333/0001-80',
          legalName: 'X',
          taxRegime: 'MEI',
          municipalReg: '  ',
        } as any);
      } catch (e) {
        expect(e).toBeInstanceOf(FiscalValidationError);
        expect((e as FiscalValidationError).issues.length).toBeGreaterThan(1);
      }
    });

    it('does not echo raw taxId in error message', () => {
      try {
        service.validateAndNormalizeCreate(
          validCreate({ taxId: '11.222.333/0001-80' }),
        );
      } catch (e) {
        expect(e).toBeInstanceOf(FiscalValidationError);
        expect(
          JSON.stringify((e as FiscalValidationError).issues),
        ).not.toContain('11.222.333');
      }
    });

    it('accepts null municipalReg (do not set)', () => {
      const result = service.validateAndNormalizeCreate(
        validCreate({ municipalReg: null as unknown as string }),
      );
      expect(result.municipalReg).toBeUndefined();
    });

    it('accepts valid municipalReg', () => {
      const result = service.validateAndNormalizeCreate(
        validCreate({ municipalReg: '  123456  ' }),
      );
      expect(result.municipalReg).toBe('123456');
    });
  });

  describe('validateAndNormalizeUpdate', () => {
    it('normalizes updated CNPJ', () => {
      const result = service.validateAndNormalizeUpdate({
        taxId: '11.222.333/0001-81',
      });
      expect(result.taxId).toBe('11222333000181');
    });

    it('throws for blank taxId update', () => {
      expect(() => service.validateAndNormalizeUpdate({ taxId: '  ' })).toThrow(
        FiscalValidationError,
      );
    });

    it('throws for invalid CNPJ in update', () => {
      expect(() =>
        service.validateAndNormalizeUpdate({ taxId: '00000000000000' }),
      ).toThrow(FiscalValidationError);
    });

    it('accepts null municipalReg (clear)', () => {
      const result = service.validateAndNormalizeUpdate({
        municipalReg: null,
      });
      expect(result.municipalReg).toBeNull();
    });

    it('throws for blank municipalReg update', () => {
      expect(() =>
        service.validateAndNormalizeUpdate({ municipalReg: '  ' }),
      ).toThrow(FiscalValidationError);
    });

    it('accepts null address (clear all)', () => {
      const result = service.validateAndNormalizeUpdate({
        address: null,
      });
      expect(result.address).toBeNull();
    });

    it('normalizes address state in update', () => {
      const result = service.validateAndNormalizeUpdate({
        address: { state: 'sp' },
      });
      expect(result.address!.state).toBe('SP');
    });

    it('groups all issues in update', () => {
      try {
        service.validateAndNormalizeUpdate({
          taxId: '  ',
          municipalReg: '  ',
        });
      } catch (e) {
        expect(e).toBeInstanceOf(FiscalValidationError);
        expect((e as FiscalValidationError).issues.length).toBeGreaterThan(1);
      }
    });
  });
});
