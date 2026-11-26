import {
  brasiliaDate,
  cents,
  isOtherPartySale,
  readCurrency,
  readCustomer,
  readMyShareCents,
  readProduct,
  readTotalCents,
} from './kiwify.payload';

describe('kiwify payload readers (tolerant: inner field names are unconfirmed)', () => {
  describe('cents', () => {
    it('accepts integers and digit strings only', () => {
      expect(cents(10000)).toBe(10000);
      expect(cents('10000')).toBe(10000);
      expect(cents(0)).toBe(0);
      for (const bad of [1.5, -1, 'x', '1.5', null, undefined, {}])
        expect(cents(bad)).toBeNull();
    });
  });

  describe('brasiliaDate', () => {
    it('reads "YYYY-MM-DD HH:mm" as Brasilia time', () => {
      expect(brasiliaDate('2026-10-29 15:00')).toEqual(
        new Date('2026-10-29T18:00:00Z'),
      );
      expect(brasiliaDate('2026-10-29 15:00:30')).toEqual(
        new Date('2026-10-29T18:00:30Z'),
      );
    });
    it('keeps ISO strings that carry their own offset', () => {
      expect(brasiliaDate('2026-10-29T18:00:00.000Z')).toEqual(
        new Date('2026-10-29T18:00:00Z'),
      );
    });
    it('is null for nothing or garbage', () => {
      for (const bad of [null, '', 'ontem', 5])
        expect(brasiliaDate(bad)).toBeNull();
    });
  });

  describe('readCustomer', () => {
    it.each([
      ['CPF', { CPF: '529.982.247-25' }],
      ['cpf', { cpf: '52998224725' }],
      ['document', { document: '529.982.247-25' }],
    ])('reads a CPF from %s', (_key, doc) => {
      expect(
        readCustomer({ Customer: { full_name: 'Maria', ...doc } }),
      ).toMatchObject({ name: 'Maria', taxId: '52998224725' });
    });
    it.each([['cnpj'], ['CNPJ']])('reads a CNPJ from %s', (key) => {
      expect(
        readCustomer({
          Customer: { name: 'ACME', [key]: '11.222.333/0001-81' },
        }),
      ).toMatchObject({ taxId: '11222333000181' });
    });
    it('builds the name from first and last name when there is no full name', () => {
      expect(
        readCustomer({ Customer: { first_name: 'Maria', last_name: 'Silva' } }),
      ).toMatchObject({ name: 'Maria Silva' });
    });
    it('also reads the sales-API spelling (lowercase customer)', () => {
      expect(
        readCustomer({
          customer: { name: 'Ana', email: 'a@x.com', cpf: '529.982.247-25' },
        }),
      ).toMatchObject({ name: 'Ana', email: 'a@x.com', taxId: '52998224725' });
    });
    it('treats a country other than Brazil as having no usable document', () => {
      for (const country of ['PT', 'US', 'Portugal'])
        expect(
          readCustomer({
            Customer: { full_name: 'A', CPF: '529.982.247-25', country },
          }),
        ).toMatchObject({ taxId: null });
      for (const country of ['BR', 'br', 'Brasil', 'Brazil'])
        expect(
          readCustomer({
            Customer: { full_name: 'A', CPF: '529.982.247-25', country },
          }),
        ).toMatchObject({ taxId: '52998224725' });
    });
    it('drops an invalid or masked document', () => {
      expect(
        readCustomer({ Customer: { full_name: 'A', CPF: '123' } }),
      ).toMatchObject({ taxId: null, taxIdMasked: false });
      expect(
        readCustomer({ Customer: { full_name: 'A', CPF: '529.***.***-25' } }),
      ).toMatchObject({ taxId: null, taxIdMasked: true });
    });
    it('is null when there is no customer or nothing in it', () => {
      expect(readCustomer({})).toBeNull();
      expect(readCustomer({ Customer: null })).toBeNull();
      expect(readCustomer({ Customer: {} })).toBeNull();
    });
  });

  describe('readProduct', () => {
    it('reads both spellings and tolerates absence', () => {
      expect(
        readProduct({ Product: { product_id: 'p', product_name: 'N' } }),
      ).toEqual({ id: 'p', name: 'N' });
      expect(readProduct({ Product: { id: 'q', name: 'M' } })).toEqual({
        id: 'q',
        name: 'M',
      });
      expect(readProduct({})).toEqual({ id: null, name: null });
    });
  });

  describe('amounts', () => {
    it('the total is what the buyer paid, then the product price as a fallback', () => {
      expect(
        readTotalCents({
          Commissions: { charge_amount: 10388, product_base_price: 9000 },
        }),
      ).toBe(10388);
      expect(readTotalCents({ payment: { charge_amount: 500 } })).toBe(500);
      expect(
        readTotalCents({ Commissions: { product_base_price: 9000 } }),
      ).toBe(9000);
      expect(readTotalCents({ Commissions: null })).toBeNull();
    });
    it('the producer share exists only when my_commission does', () => {
      expect(readMyShareCents({ Commissions: { my_commission: 8000 } })).toBe(
        8000,
      );
      expect(
        readMyShareCents({ Commissions: { charge_amount: 1 } }),
      ).toBeNull();
      expect(readMyShareCents({})).toBeNull();
    });
    it('the currency is upper-cased and defaults to BRL', () => {
      expect(readCurrency({ Commissions: { currency: 'usd' } })).toBe('USD');
      expect(readCurrency({ Commissions: { charge_currency: 'eur' } })).toBe(
        'EUR',
      );
      expect(readCurrency({ payment: { charge_currency: 'BRL' } })).toBe('BRL');
      expect(readCurrency({})).toBe('BRL');
    });
  });

  describe('isOtherPartySale', () => {
    it('is true only when sale_type says it is not the producer', () => {
      expect(isOtherPartySale({ sale_type: 'affiliate' })).toBe(true);
      expect(isOtherPartySale({ sale_type: 'coproducer' })).toBe(true);
      expect(isOtherPartySale({ sale_type: 'producer' })).toBe(false);
      expect(isOtherPartySale({})).toBe(false);
    });
  });
});
