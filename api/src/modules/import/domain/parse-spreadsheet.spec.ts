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

describe('parseSpreadsheet (csv edge cases)', () => {
  it('reads Windows-1252 punctuation (dash, curly quotes) as itself, not as control characters', async () => {
    const bytes = Buffer.concat([
      Buffer.from('descricao;valor\n'),
      Buffer.from([
        0x54, 0xe9, 0x63, 0x6e, 0x69, 0x63, 0x6f, 0x20, 0x96, 0x20, 0x31, 0x94,
      ]),
      Buffer.from(';10\n'),
    ]);
    const { rows } = await parseSpreadsheet(bytes, 'csv');
    expect(rows[0]?.cells.descricao).toBe('Técnico – 1”');
  });

  it('reads a UTF-16 file with a BOM, as Excel saves "Unicode text"', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('valor;descricao\n10;Serviço\n', 'utf16le'),
    ]);
    const { rows } = await parseSpreadsheet(bytes, 'csv');
    expect(rows[0]?.cells).toEqual({ valor: '10', descricao: 'Serviço' });
  });

  it('survives a stray double quote inside an unquoted field', async () => {
    const { rows } = await parseSpreadsheet(
      csv('descricao;valor\nTela 5" polegadas;10\n'),
      'csv',
    );
    expect(rows[0]?.cells.descricao).toBe('Tela 5" polegadas');
  });

  it('does not build millions of rows out of blank lines, and still keeps the real line numbers', async () => {
    const started = Date.now();
    await expect(
      parseSpreadsheet(csv('valor\n' + '\n'.repeat(3_000_000)), 'csv'),
    ).rejects.toMatchObject({ code: 'ERROR_IMPORT_EMPTY' });
    expect(Date.now() - started).toBeLessThan(5000);
    const { rows } = await parseSpreadsheet(csv('valor\n\n\n5\n'), 'csv');
    expect(rows).toEqual([{ line: 4, cells: { valor: '5' } }]);
  });

  it('takes the header from the first line that is not blank', async () => {
    const { rows } = await parseSpreadsheet(csv('\n\nvalor\n7\n'), 'csv');
    expect(rows).toEqual([{ line: 4, cells: { valor: '7' } }]);
  });

  it('stops counting at 2,000 rows even when many blank lines are mixed in', async () => {
    const lines = Array.from({ length: 2001 }, (_, i) => `${i + 1}\n\n`).join(
      '',
    );
    await expect(
      parseSpreadsheet(csv('valor\n' + lines), 'csv'),
    ).rejects.toMatchObject({ code: 'ERROR_IMPORT_TOO_MANY_ROWS' });
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

  it('does not blow up on a tiny file that declares a huge sheet (one cell far away)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Notas');
    ws.getCell('A1').value = 'valor';
    ws.getCell('XFD3000').value = 'x';
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const started = Date.now();
    await expect(parseSpreadsheet(bytes, 'xlsx')).rejects.toMatchObject({
      code: 'ERROR_IMPORT_EMPTY',
    });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('rejects a workbook that would unzip to more than 50 MB', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notas').addRow(['valor']);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    // Central directory entries start with PK\x01\x02; the uncompressed size sits 24 bytes in.
    for (
      let at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      at >= 0;
      at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)
    )
      bytes.writeUInt32LE(60 * 1024 * 1024, at + 24);
    await expect(parseSpreadsheet(bytes, 'xlsx')).rejects.toMatchObject({
      code: 'ERROR_IMPORT_UNREADABLE',
    });
  });

  it('keeps the real sheet line when the header is not on the first row', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Notas');
    ws.getRow(3).values = ['Descrição', 'Valor'];
    ws.getRow(4).values = ['Serviço', 10];
    const { rows } = await parseSpreadsheet(
      Buffer.from(await wb.xlsx.writeBuffer()),
      'xlsx',
    );
    expect(rows).toEqual([
      { line: 4, cells: { descricao: 'Serviço', valor: '10' } },
    ]);
  });

  it('rounds the float noise of calculated cells to cents, and leaves real extra decimals alone', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Notas');
    ws.addRow(['Descrição', 'Valor']);
    ws.addRow(['a', { formula: 'A*1.1', result: 110.00000000000001 }]);
    ws.addRow(['b', 0.1 + 0.2]);
    ws.addRow(['c', 10.005]);
    const { rows } = await parseSpreadsheet(
      Buffer.from(await wb.xlsx.writeBuffer()),
      'xlsx',
    );
    expect(rows.map((r) => r.cells.valor)).toEqual(['110', '0.3', '10.005']);
  });
});
