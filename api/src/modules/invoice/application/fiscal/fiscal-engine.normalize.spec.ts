import type { Company } from '@/modules/company/domain/company';
import { toNormalizedInvoice } from './fiscal-engine.service';

const company = {
  taxId: '11222333000181',
  municipalityCode: '3550308',
  municipalReg: null,
} as unknown as Company;

const input = (overrides: { discount?: number; deduction?: number } = {}) => ({
  companyId: 'comp-1',
  customer: null,
  service: { code: '010601', municipalityCode: '3550308' },
  amount: 1000,
  competenceDate: new Date('2026-10-13'),
  ...overrides,
});

const normalize = (overrides: { discount?: number; deduction?: number } = {}) =>
  toNormalizedInvoice(input(overrides), company, 'ten-1', 'test', 'inv-1');

describe('toNormalizedInvoice — declared deduction', () => {
  it('maps the deduction to a money string', () => {
    expect(normalize({ deduction: 400 }).deductionAmount).toBe('400.00');
  });

  it('keeps the deduction independent from the discount', () => {
    const normalized = normalize({ discount: 50, deduction: 400.5 });
    expect(normalized.discountAmount).toBe('50.00');
    expect(normalized.deductionAmount).toBe('400.50');
  });

  it.each([[undefined], [0]])(
    'omits the deduction when it is %s',
    (deduction) => {
      expect(normalize({ deduction })).not.toHaveProperty('deductionAmount');
    },
  );
});
