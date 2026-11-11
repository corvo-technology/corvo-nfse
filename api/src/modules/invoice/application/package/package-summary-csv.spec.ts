import {
  buildSummaryCsv,
  SUMMARY_HEADERS,
  type PackageSummaryRow,
} from './package-summary-csv';

const base: PackageSummaryRow = {
  number: '123',
  issuedAt: new Date('2026-11-05T15:00:00Z'),
  competenceDate: '2026-11-04',
  cancelled: false,
  customerTaxId: '12345678000195',
  customerName: 'Acme Ltda',
  serviceCode: '010101',
  description: 'Consultoria',
  gross: '1500.50',
  discount: '0.50',
  iss: '75.00',
  net: '1425.00',
  accessKey: 'K'.repeat(50),
  documents: 'ok',
};

const lines = (csv: string) => csv.split('\r\n');

describe('buildSummaryCsv', () => {
  it('starts with a BOM and has 14 columns separated by semicolons', () => {
    const csv = buildSummaryCsv([base]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(SUMMARY_HEADERS).toHaveLength(14);
    expect(lines(csv)[0].slice(1).split(';')).toEqual([...SUMMARY_HEADERS]);
    expect(lines(csv)[1].split(';')).toHaveLength(14);
  });

  it('uses decimal comma and dd/mm/yyyy dates', () => {
    const [, row] = lines(buildSummaryCsv([base]));
    expect(row.split(';').slice(0, 4)).toEqual([
      '123',
      '05/11/2026',
      '04/11/2026',
      'autorizada',
    ]);
    expect(row).toContain(';1500,50;0,50;75,00;1425,00;');
  });

  it('escapes quotes, semicolons and line breaks inside quoted cells', () => {
    const csv = buildSummaryCsv([
      { ...base, description: 'Linha 1\nLinha "2"; fim', customerName: 'A;B' },
    ]);
    expect(csv).toContain('"A;B"');
    expect(csv).toContain('"Linha 1\nLinha ""2""; fim"');
  });

  it('leaves missing values blank and keeps the column count', () => {
    const [, row] = lines(
      buildSummaryCsv([
        {
          number: null,
          issuedAt: null,
          competenceDate: '2026-11-01',
          cancelled: true,
          documents: 'pendente',
        },
      ]),
    );
    expect(row).toBe(';;01/11/2026;cancelada;;;;;;;;;;pendente');
  });

  it('defuses formulas typed in free text', () => {
    const [, row] = lines(
      buildSummaryCsv([{ ...base, customerName: '=HYPERLINK("x")' }]),
    );
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
