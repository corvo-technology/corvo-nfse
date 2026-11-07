import type { ParsedRow } from './parse-spreadsheet';

export type NormalizedRow = {
  item: Record<string, unknown>;
  /** Prestador CNPJ, digits only, when the row carries one. */
  cnpjPrestador?: string;
};

const digits = (value: string | undefined) =>
  value ? value.replace(/\D/g, '') : '';

/**
 * Reais as text to a number with exact cents. Anything unreadable comes back untouched,
 * so the invoice validation rejects it with its own catalog error.
 */
function parseAmount(raw: string | undefined): number | string | undefined {
  if (raw === undefined) return undefined;
  const text = raw.replace(/R\$/i, '').replace(/\s/g, '');
  let integer: string;
  let cents: string;
  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(text) || /^\d+,\d+$/.test(text)) {
    [integer = '', cents = ''] = text.replaceAll('.', '').split(',');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    integer = text.replaceAll('.', '');
    cents = '';
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    [integer = '', cents = ''] = text.split('.');
  } else return raw;
  if (cents.length > 2) return raw;
  const total = Number(integer) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(total) ? total / 100 : raw;
}

function parseDate(raw: string | undefined, today: string): string {
  if (raw === undefined) return today;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = br
    ? `${br[3]}-${br[2]}-${br[1]}`
    : /^\d{4}-\d{2}-\d{2}/.test(raw)
      ? raw.slice(0, 10)
      : null;
  if (!iso) return raw;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : raw;
}

export function normalizeRow(
  cells: ParsedRow['cells'],
  today: string,
): NormalizedRow {
  const customer: Record<string, string> = {};
  const taxId = digits(cells.tomadorDocumento);
  if (taxId) customer.taxId = taxId;
  if (cells.tomadorNome?.trim()) customer.name = cells.tomadorNome.trim();
  if (cells.tomadorEmail?.trim()) customer.email = cells.tomadorEmail.trim();

  const service: Record<string, string> = {};
  if (cells.descricao?.trim()) service.description = cells.descricao.trim();
  if (cells.codigoServico?.trim())
    service.code = digits(cells.codigoServico) || cells.codigoServico.trim();

  const item: Record<string, unknown> = {
    service,
    amount: parseAmount(cells.valor),
    competenceDate: parseDate(cells.dataCompetencia, today),
  };
  if (Object.keys(customer).length) item.customer = customer;
  const cnpj = digits(cells.cnpjPrestador);
  return cnpj ? { item, cnpjPrestador: cnpj } : { item };
}
