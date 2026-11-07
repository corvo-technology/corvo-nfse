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
  if (typeof value === 'number') return numberToText(value);
  return String(value).trim();
}

/** Excel stores calculated money with binary noise (110.00000000000001): snap to cents when that is all it is. */
function numberToText(value: number): string {
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6
    ? String(Math.round(cents) / 100)
    : String(value);
}

type GridRow = { line: number; cells: string[] };

function toSheet(grid: GridRow[]): ParsedSheet {
  const [headerRow, ...body] = grid;
  const header = headerRow?.cells;
  if (!header || header.every((h) => !h.trim()))
    throw new ImportError('ERROR_IMPORT_EMPTY', 'The file has no rows');
  const keys = header.map((h) => columnFor(h));
  const unknownColumns = header
    .filter((h, i) => h.trim() && !keys[i])
    .map((h) => h.trim());
  const rows: ParsedRow[] = [];
  body.forEach(({ line, cells }) => {
    const row: ParsedRow['cells'] = {};
    cells.forEach((cell, i) => {
      const key = keys[i];
      const text = cell.trim();
      if (key && text && row[key] === undefined) row[key] = text;
    });
    if (Object.keys(row).length === 0 && cells.every((c) => !c.trim())) return;
    rows.push({ line, cells: row });
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

/** Header columns read at most; everything to the right is ignored. */
const MAX_COLUMNS = 100;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
/** Rows read before giving up: the limit plus the header, with a little room to notice the excess. */
const ROW_SCAN_LIMIT = MAX_IMPORT_ROWS + 2;

/** Sum of the sizes the zip says its entries unpack to, read from the central directory. */
function unzippedSize(bytes: Buffer): number {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 20 > bytes.length) return Infinity;
  const entries = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50)
      return Infinity;
    total += bytes.readUInt32LE(at + 24);
    at +=
      46 +
      bytes.readUInt16LE(at + 28) +
      bytes.readUInt16LE(at + 30) +
      bytes.readUInt16LE(at + 32);
  }
  return total;
}

async function parseXlsx(bytes: Buffer): Promise<ParsedSheet> {
  if (!bytes.subarray(0, 2).equals(ZIP_MAGIC))
    throw new ImportError('ERROR_IMPORT_UNREADABLE', 'Not an Excel file');
  if (unzippedSize(bytes) > MAX_UNZIPPED_BYTES)
    throw new ImportError(
      'ERROR_IMPORT_UNREADABLE',
      'The Excel file is too large once unpacked',
    );
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
  // Only rows that really hold something, never the sheet's declared size: a tiny file can declare a million rows and 16,000 columns.
  const grid: GridRow[] = [];
  let width = 0;
  sheet.eachRow({ includeEmpty: false }, (row, line) => {
    if (grid.length >= ROW_SCAN_LIMIT) return;
    if (grid.length === 0) width = Math.min(row.cellCount, MAX_COLUMNS);
    grid.push({
      line,
      cells: Array.from({ length: width }, (_, i) =>
        cellToText(row.getCell(i + 1).value),
      ),
    });
  });
  return toSheet(grid);
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
  return toSheet(grid.map((cells, index) => ({ line: index + 1, cells })));
}

export async function parseSpreadsheet(
  bytes: Buffer,
  kind: 'csv' | 'xlsx',
): Promise<ParsedSheet> {
  return kind === 'xlsx' ? parseXlsx(bytes) : parseCsv(bytes);
}
