import ExcelJS from 'exceljs';
import { ImportError } from './import-error';
import { parseSpreadsheet } from './parse-spreadsheet';

const csv = (text: string, encoding: BufferEncoding = 'utf8') =>
  Buffer.from(text, encoding);

describe('parseSpreadsheet (csv)', () => {
  it('reads a semicolon file with BOM, quotes and accents, naming columns by alias', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      csv(
        'Nome do Tomador;CPF/CNPJ;Descrição;Valor\n"Ana; Silva";123.456.789-09;"Consultoria ""premium""";1.234,56\n',
      ),
    ]);
    const { rows } = await parseSpreadsheet(bytes, 'csv');
    expect(rows).toEqual([
      {
        line: 2,
        cells: {
          tomadorNome: 'Ana; Silva',
          tomadorDocumento: '123.456.789-09',
          descricao: 'Consultoria "premium"',
          valor: '1.234,56',
        },
      },
    ]);
  });

  it('reads Latin-1 files without breaking accents', async () => {
    const { rows } = await parseSpreadsheet(
      csv('descricao;valor\nConsultoria técnica;10,00\n', 'latin1'),
      'csv',
    );
    expect(rows[0]?.cells.descricao).toBe('Consultoria técnica');
  });

  it('reads comma files, skips blank lines and keeps real line numbers', async () => {
    const { rows } = await parseSpreadsheet(
      csv('description,amount\nA,1\n\n,\nB,2\n'),
      'csv',
    );
    expect(rows.map((r) => r.line)).toEqual([2, 5]);
  });

  it('reports columns it does not know', async () => {
    const { unknownColumns } = await parseSpreadsheet(
      csv('valor;obs;cor\n1;x;y\n'),
      'csv',
    );
    expect(unknownColumns).toEqual(['obs', 'cor']);
  });

  it('rejects an empty file, a header with no rows and too many rows', async () => {
    await expect(parseSpreadsheet(csv(''), 'csv')).rejects.toMatchObject({
      code: 'ERROR_IMPORT_EMPTY',
    });
    await expect(
      parseSpreadsheet(csv('valor;descricao\n'), 'csv'),
    ).rejects.toMatchObject({ code: 'ERROR_IMPORT_EMPTY' });
    const big = 'valor\n' + '1\n'.repeat(2001);
    await expect(parseSpreadsheet(csv(big), 'csv')).rejects.toMatchObject({
      code: 'ERROR_IMPORT_TOO_MANY_ROWS',
    });
    const ok = 'valor\n' + '1\n'.repeat(2000);
    expect((await parseSpreadsheet(csv(ok), 'csv')).rows).toHaveLength(2000);
  });

  it('rejects xlsx bytes sent as csv, and csv text sent as xlsx', async () => {
    await expect(
      parseSpreadsheet(Buffer.from('PK\x03\x04xxxx'), 'csv'),
    ).rejects.toBeInstanceOf(ImportError);
    await expect(
      parseSpreadsheet(csv('valor\n1\n'), 'xlsx'),
    ).rejects.toMatchObject({ code: 'ERROR_IMPORT_UNREADABLE' });
  });
});

describe('parseSpreadsheet (xlsx)', () => {
  it('reads numeric, date and cached-formula cells as text', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Notas');
    ws.addRow(['Descrição', 'Valor', 'Data de competência']);
    ws.addRow(['Serviço', 1234.5, new Date(Date.UTC(2026, 10, 7))]);
    ws.addRow(['Fórmula', { formula: '100+20', result: 120 }, '07/11/2026']);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const { rows } = await parseSpreadsheet(bytes, 'xlsx');
    expect(rows).toEqual([
      {
        line: 2,
        cells: {
          descricao: 'Serviço',
          valor: '1234.5',
          dataCompetencia: '2026-11-07',
        },
      },
      {
        line: 3,
        cells: {
          descricao: 'Fórmula',
          valor: '120',
          dataCompetencia: '07/11/2026',
        },
      },
    ]);
  });
});
