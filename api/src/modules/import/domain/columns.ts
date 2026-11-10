export const COLUMN_KEYS = [
  'cnpjPrestador',
  'tomadorDocumento',
  'tomadorNome',
  'tomadorEmail',
  'descricao',
  'valor',
  'codigoServico',
  'dataCompetencia',
  'pedido',
  'observacoes',
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** Header spellings accepted per column, already folded (see `foldHeader`). */
const ALIASES: Record<ColumnKey, string[]> = {
  cnpjPrestador: [
    'cnpjprestador',
    'cnpjemissor',
    'prestador',
    'companytaxid',
    'cnpj',
  ],
  tomadorDocumento: [
    'tomadordocumento',
    'documentotomador',
    'cpfcnpjtomador',
    'cpfcnpj',
    'customertaxid',
    'taxid',
  ],
  tomadorNome: [
    'tomadornome',
    'nometomador',
    'nomedotomador',
    'tomador',
    'cliente',
    'customername',
    'name',
  ],
  tomadorEmail: [
    'tomadoremail',
    'emailtomador',
    'emaildotomador',
    'email',
    'customeremail',
  ],
  descricao: [
    'descricao',
    'descricaoservico',
    'descricaodoservico',
    'servico',
    'description',
  ],
  valor: ['valor', 'valorservico', 'valordoservico', 'amount', 'value'],
  codigoServico: ['codigoservico', 'codigodoservico', 'servicecode'],
  dataCompetencia: [
    'datacompetencia',
    'datadecompetencia',
    'competencia',
    'competencedate',
    'data',
  ],
  pedido: [
    'pedido',
    'numeropedido',
    'numerodopedido',
    'ordemdecompra',
    'ordemdeservico',
    'purchaseorder',
  ],
  observacoes: [
    'observacoes',
    'observacao',
    'informacoescomplementares',
    'notes',
  ],
};

const BY_ALIAS = new Map<string, ColumnKey>(
  (Object.entries(ALIASES) as [ColumnKey, string[]][]).flatMap(([key, list]) =>
    list.map((alias) => [alias, key] as const),
  ),
);

/** Lowercase, no accents, letters and digits only: "Descrição do Serviço" becomes "descricaodoservico". */
export function foldHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function columnFor(header: string): ColumnKey | undefined {
  return BY_ALIAS.get(foldHeader(header));
}
