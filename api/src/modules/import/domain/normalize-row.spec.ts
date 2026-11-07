import { normalizeRow } from './normalize-row';

const TODAY = '2026-11-07';
const base = { descricao: 'Consultoria', valor: '100,00' };

describe('normalizeRow', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1234.56', 1234.56],
    ['R$ 1.234,56', 1234.56],
    ['1234,5', 1234.5],
    ['1.234', 1234],
    ['10', 10],
    ['0,07', 0.07],
    ['120', 120],
  ])('reads %s as %s', (valor, amount) => {
    expect(normalizeRow({ ...base, valor }, TODAY).item.amount).toBe(amount);
  });

  it.each(['abc', '1,234,56', '-5', '10,999', ''])(
    'leaves %j for validation to reject',
    (valor) => {
      const amount = normalizeRow({ ...base, valor }, TODAY).item.amount;
      expect(typeof amount === 'number').toBe(false);
    },
  );

  it('strips punctuation from documents and the prestador CNPJ', () => {
    const out = normalizeRow(
      {
        ...base,
        tomadorDocumento: '123.456.789-09',
        tomadorNome: ' Ana ',
        tomadorEmail: 'a@x.com',
        cnpjPrestador: '12.345.678/0001-95',
      },
      TODAY,
    );
    expect(out.cnpjPrestador).toBe('12345678000195');
    expect(out.item).toMatchObject({
      customer: { taxId: '12345678909', name: 'Ana', email: 'a@x.com' },
      service: { description: 'Consultoria' },
    });
  });

  it('accepts both date formats, defaults to today and keeps junk for validation', () => {
    expect(
      normalizeRow({ ...base, dataCompetencia: '07/11/2026' }, TODAY).item
        .competenceDate,
    ).toBe('2026-11-07');
    expect(
      normalizeRow({ ...base, dataCompetencia: '2026-11-06' }, TODAY).item
        .competenceDate,
    ).toBe('2026-11-06');
    expect(normalizeRow(base, TODAY).item.competenceDate).toBe(TODAY);
    expect(
      normalizeRow({ ...base, dataCompetencia: '31/02/2026' }, TODAY).item
        .competenceDate,
    ).toBe('31/02/2026');
  });

  it('omits the customer when none of its cells is filled and sets the service code only when given', () => {
    const none = normalizeRow(base, TODAY).item;
    expect(none.customer).toBeUndefined();
    expect((none.service as Record<string, unknown>).code).toBeUndefined();
    expect(
      (
        normalizeRow({ ...base, codigoServico: '010101' }, TODAY).item
          .service as { code: string }
      ).code,
    ).toBe('010101');
  });

  it('restores the leading zeros Excel drops from CPF and CNPJ typed as numbers', () => {
    const out = normalizeRow(
      {
        ...base,
        tomadorDocumento: '1234567890',
        cnpjPrestador: '345678000195',
      },
      TODAY,
    );
    expect(out.item.customer).toMatchObject({ taxId: '01234567890' });
    expect(out.cnpjPrestador).toBe('00345678000195');
    expect(
      normalizeRow({ ...base, tomadorDocumento: '1234567890123' }, TODAY).item
        .customer,
    ).toMatchObject({ taxId: '01234567890123' });
    expect(
      normalizeRow({ ...base, tomadorDocumento: '52998224725' }, TODAY).item
        .customer,
    ).toMatchObject({ taxId: '52998224725' });
    expect(
      normalizeRow({ ...base, tomadorDocumento: '123' }, TODAY).item.customer,
    ).toMatchObject({ taxId: '123' });
  });
});
