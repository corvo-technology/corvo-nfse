/** Pure formatters for the DANFSe. Empty values print as "-" (NT 008/2026, note 12). */
export const DASH = '-';

export const dash = (value?: string | null): string =>
  value !== undefined && value !== null && value.trim() !== ''
    ? value.trim()
    : DASH;

/** CNPJ (numeric or alphanumeric) as 00.000.000/0000-00, CPF as 000.000.000-00; anything else as is. */
export function formatTaxId(value?: string | null): string {
  const raw = (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (/^\d{11}$/.test(raw)) {
    return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (/^[0-9A-Z]{12}\d{2}$/.test(raw)) {
    return raw.replace(
      /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  }
  return dash(value);
}

export function formatCep(value?: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(digits)
    ? digits.replace(/^(\d{5})(\d{3})$/, '$1-$2')
    : dash(value);
}

export function formatPhone(value?: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) {
    return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  }
  if (/^\d{11}$/.test(digits)) {
    return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  }
  return dash(value);
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** `R$ 1.234,56`, with a plain space (the PDF fonts do not need the no-break one). */
export function formatMoney(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? money.format(value).replace(/\u00a0/g, ' ')
    : DASH;
}

export function formatPercent(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${decimal.format(value)} %`
    : DASH;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date-only value (it is parsed as UTC midnight): DD/MM/AAAA. */
export function formatDate(value?: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return DASH;
  return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** An instant, shown in Brasília time: DD/MM/AAAA HH:MM:SS. */
export function formatDateTime(value?: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return DASH;
  return dateTime.format(value).replace(',', '');
}

/** cTribNac `010301` as `01.03.01`. */
export function formatCTribNac(value?: string | null): string {
  const raw = (value ?? '').replace(/\D/g, '');
  return /^\d{6}$/.test(raw)
    ? raw.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3')
    : dash(value);
}

/** NBS `115011000` as `1.1501.10.00`. */
export function formatNbs(value?: string | null): string {
  const raw = (value ?? '').replace(/\D/g, '');
  return /^\d{9}$/.test(raw)
    ? raw.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4')
    : dash(value);
}
