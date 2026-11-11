/** One line of resumo.csv: what the accountant needs to know about an invoice. */
export interface PackageSummaryRow {
  number: string | null;
  /** Authorization moment; shown as a São Paulo calendar date. */
  issuedAt: Date | null;
  /** Pure date, YYYY-MM-DD. */
  competenceDate: string;
  cancelled: boolean;
  customerTaxId?: string | null;
  customerName?: string | null;
  serviceCode?: string | null;
  description?: string | null;
  /** Decimal strings with a dot, as stored (e.g. "1234.50"). */
  gross?: string | null;
  discount?: string | null;
  iss?: string | null;
  net?: string | null;
  accessKey?: string | null;
  documents: 'ok' | 'pendente' | 'indisponível';
}

export const SUMMARY_HEADERS = [
  'Número',
  'Data de emissão',
  'Competência',
  'Status',
  'Documento do tomador',
  'Nome do tomador',
  'Código do serviço',
  'Descrição',
  'Valor bruto',
  'Desconto',
  'ISS',
  'Valor líquido',
  'Chave de acesso',
  'Documentos',
] as const;

const BOM = '﻿';
const SEPARATOR = ';';
const NEWLINE = '\r\n';
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Quotes a cell when it holds the separator, a quote or a line break. */
function cell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Free text typed by someone else: a leading = + - @ would run as a formula in Excel. */
function text(value: string | null | undefined): string {
  if (!value) return '';
  return cell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

function money(value: string | null | undefined): string {
  return value ? value.replace('.', ',') : '';
}

function day(value: string): string {
  const [year, month, date] = value.split('-');
  return `${date}/${month}/${year}`;
}

export function summaryLine(row: PackageSummaryRow): string {
  return [
    row.number ?? '',
    row.issuedAt ? dateFormat.format(row.issuedAt) : '',
    day(row.competenceDate),
    row.cancelled ? 'cancelada' : 'autorizada',
    row.customerTaxId ?? '',
    text(row.customerName),
    row.serviceCode ?? '',
    text(row.description),
    money(row.gross),
    money(row.discount),
    money(row.iss),
    money(row.net),
    row.accessKey ?? '',
    row.documents,
  ].join(SEPARATOR);
}

/** Opens straight in Excel pt-BR: `;` separator, decimal comma, UTF-8 with BOM. */
export function buildSummaryCsv(rows: PackageSummaryRow[]): string {
  return (
    BOM +
    [SUMMARY_HEADERS.join(SEPARATOR), ...rows.map(summaryLine)].join(NEWLINE) +
    NEWLINE
  );
}
