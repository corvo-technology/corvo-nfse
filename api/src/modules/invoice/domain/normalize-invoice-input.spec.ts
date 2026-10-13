import { normalizeInvoiceInput } from './normalize-invoice-input';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    customer: {
      name: 'Cliente',
      taxId: '529.982.247-25',
      email: 'cliente@example.com',
    },
    service: { code: '010101', description: 'Servico' },
    amount: 100.5,
    competenceDate: '2026-01-01',
    options: { email: { send: true } },
    ...overrides,
  };
}

describe('normalizeInvoiceInput', () => {
  it('normalizes valid input', () => {
    const result = normalizeInvoiceInput(validInput());
    expect(result.customer.taxId).toBe('52998224725');
    expect(result.customer.taxIdKind).toBe('CPF');
    expect(result.amount).toBe(100.5);
    expect(result.service.code).toBe('010101');
  });

  it('parses CNPJ correctly', () => {
    const result = normalizeInvoiceInput(
      validInput({
        customer: {
          name: 'X',
          taxId: '11.222.333/0001-81',
          email: 'x@example.com',
        },
        options: { email: { send: true } },
      }),
    );
    expect(result.customer.taxId).toBe('11222333000181');
    expect(result.customer.taxIdKind).toBe('CNPJ');
  });

  it('throws FiscalValidationError for invalid taxId', () => {
    expect(() =>
      normalizeInvoiceInput(
        validInput({ customer: { name: 'X', taxId: '00000000000' } }),
      ),
    ).toThrow(FiscalValidationError);
  });

  it('throws for incomplete address (city without state)', () => {
    expect(() =>
      normalizeInvoiceInput(
        validInput({
          customer: {
            name: 'X',
            taxId: '529.982.247-25',
            address: { city: 'Sao Paulo' },
          },
        }),
      ),
    ).toThrow(FiscalValidationError);
  });

  it('throws for incomplete address (state without city)', () => {
    expect(() =>
      normalizeInvoiceInput(
        validInput({
          customer: {
            name: 'X',
            taxId: '529.982.247-25',
            address: { state: 'SP' },
          },
        }),
      ),
    ).toThrow(FiscalValidationError);
  });

  it('throws for invalid service.code (not 6 digits)', () => {
    expect(() =>
      normalizeInvoiceInput(validInput({ service: { code: '12345' } })),
    ).toThrow(FiscalValidationError);
    expect(() =>
      normalizeInvoiceInput(validInput({ service: { code: '1234567' } })),
    ).toThrow(FiscalValidationError);
  });

  it('throws for invalid municipalityCode (not 7 digits)', () => {
    expect(() =>
      normalizeInvoiceInput(
        validInput({ service: { code: '010101', municipalityCode: '530010' } }),
      ),
    ).toThrow(FiscalValidationError);
  });

  it('throws for amount with more than 2 decimal places', () => {
    expect(() =>
      normalizeInvoiceInput(validInput({ amount: 100.999 })),
    ).toThrow(FiscalValidationError);
  });

  it('throws for negative amount', () => {
    expect(() => normalizeInvoiceInput(validInput({ amount: -10 }))).toThrow(
      FiscalValidationError,
    );
  });

  it('throws for amount exceeding ceiling', () => {
    expect(() =>
      normalizeInvoiceInput(validInput({ amount: 10000000000 })),
    ).toThrow(FiscalValidationError);
  });

  it('throws for future competenceDate', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(() =>
      normalizeInvoiceInput(
        validInput({ competenceDate: future.toISOString() }),
      ),
    ).toThrow(FiscalValidationError);
  });

  it('allows future date when allowFutureDate=true', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(() =>
      normalizeInvoiceInput(
        validInput({ competenceDate: future.toISOString() }),
        true,
      ),
    ).not.toThrow();
  });

  it('throws for missing email when email.send=true', () => {
    expect(() =>
      normalizeInvoiceInput(
        validInput({
          customer: { name: 'X', taxId: '529.982.247-25' },
          options: { email: { send: true } },
        }),
      ),
    ).toThrow(FiscalValidationError);
  });

  it('does not throw for missing email when email.send=false', () => {
    expect(() =>
      normalizeInvoiceInput(
        validInput({ options: { email: { send: false } } }),
      ),
    ).not.toThrow();
  });

  it('groups all issues in FiscalValidationError', () => {
    try {
      normalizeInvoiceInput({} as any);
    } catch (e) {
      expect(e).toBeInstanceOf(FiscalValidationError);
      expect((e as FiscalValidationError).issues.length).toBeGreaterThan(1);
    }
  });
});
