import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { columnFor, type ColumnKey } from './columns';
import { ImportError } from './import-error';
import { MAX_IMPORT_ROWS } from './import';

export type ParsedRow = {
  line: number;
  cells: Partial<Record<ColumnKey, string>>;
};
export type ParsedSheet = { rows: ParsedRow[]; unknownColumns: string[] };

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);

function decodeText(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8').replace(/^\uFEFF/, '');
  // Excel in Brazil often saves Windows-1252: bytes that are not valid UTF-8 show up as U+FFFD.
  return utf8.includes('\uFFFD') ? bytes.toString('latin1') : utf8;
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', '\t', ','].map(
    (d) => [d, first.split(d).length - 1] as const,
  );
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // Formulas are never evaluated: only the value Excel cached is read.
    if ('result' in value) return cellToText(value.result);
    if ('richText' in value)
      return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value).trim();
}

function toSheet(grid: string[][], firstLine: number): ParsedSheet {
  const [header, ...body] = grid;
  if (!header || header.every((h) => !h.trim()))
    throw new ImportError('ERROR_IMPORT_EMPTY', 'The file has no rows');
  const keys = header.map((h) => columnFor(h));
  const unknownColumns = header
    .filter((h, i) => h.trim() && !keys[i])
    .map((h) => h.trim());
  const rows: ParsedRow[] = [];
  body.forEach((cells, index) => {
    const row: ParsedRow['cells'] = {};
    cells.forEach((cell, i) => {
      const key = keys[i];
      const text = cell.trim();
      if (key && text && row[key] === undefined) row[key] = text;
    });
    if (Object.keys(row).length === 0 && cells.every((c) => !c.trim())) return;
    rows.push({ line: firstLine + 1 + index, cells: row });
  });
  if (rows.length === 0)
    throw new ImportError('ERROR_IMPORT_EMPTY', 'The file has no rows');
  if (rows.length > MAX_IMPORT_ROWS)
    throw new ImportError(
      'ERROR_IMPORT_TOO_MANY_ROWS',
      `The file has more than ${MAX_IMPORT_ROWS} rows`,
    );
  return { rows, unknownColumns };
}

async function parseXlsx(bytes: Buffer): Promise<ParsedSheet> {
  if (!bytes.subarray(0, 2).equals(ZIP_MAGIC))
    throw new ImportError('ERROR_IMPORT_UNREADABLE', 'Not an Excel file');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ImportError(
      'ERROR_IMPORT_UNREADABLE',
      'The Excel file could not be read',
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet)
    throw new ImportError('ERROR_IMPORT_EMPTY', 'The file has no rows');
  const width = sheet.columnCount;
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    grid.push(
      Array.from({ length: width }, (_, i) =>
        cellToText(row.getCell(i + 1).value),
      ),
    );
  });
  return toSheet(grid, 1);
}

function parseCsv(bytes: Buffer): ParsedSheet {
  if (bytes.subarray(0, 2).equals(ZIP_MAGIC))
    throw new ImportError(
      'ERROR_IMPORT_UNREADABLE',
      'This looks like an Excel file, not a CSV',
    );
  const text = decodeText(bytes);
  if (!text.trim())
    throw new ImportError('ERROR_IMPORT_EMPTY', 'The file has no rows');
  let grid: string[][];
  try {
    grid = parse(text, {
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      skip_empty_lines: false,
      bom: true,
    });
  } catch {
    throw new ImportError(
      'ERROR_IMPORT_UNREADABLE',
      'The CSV file could not be read',
    );
  }
  return toSheet(grid, 1);
}

export async function parseSpreadsheet(
  bytes: Buffer,
  kind: 'csv' | 'xlsx',
): Promise<ParsedSheet> {
  return kind === 'xlsx' ? parseXlsx(bytes) : parseCsv(bytes);
}
