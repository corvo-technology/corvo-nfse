import type { PackageNfe } from '../infra/typeorm-nfe-package.query';

export const NFE_SUMMARY_HEADERS = [
  'numero',
  'serie',
  'chave',
  'status',
  'data',
  'valor',
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

/** `nfe-resumo.csv`, like the NFS-e `resumo.csv`: `;` separator, decimal comma, UTF-8 with BOM. */
export function buildNfeSummaryCsv(rows: PackageNfe[]): string {
  const lines = rows.map((row) =>
    [
      row.number === null ? '' : String(row.number),
      row.series === null ? '' : String(row.series),
      row.accessKey ?? '',
      row.status === 'cancelled' ? 'cancelada' : 'autorizada',
      row.issuedAt ? dateFormat.format(row.issuedAt) : '',
      row.total.replace('.', ','),
    ].join(SEPARATOR),
  );
  return (
    BOM +
    [NFE_SUMMARY_HEADERS.join(SEPARATOR), ...lines].join(NEWLINE) +
    NEWLINE
  );
}
