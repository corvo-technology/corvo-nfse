/** Siglas por prefixo IBGE (2 dígitos) da tabela oficial de municípios. */
const IBGE_PREFIX_TO_UF: Readonly<Record<string, string>> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

/**
 * Converte o código IBGE do município (7 dígitos) na sigla da UF pelos dois
 * primeiros dígitos; null quando o código é inválido ou o prefixo não existe
 * (ex.: códigos fictícios de ambiente de teste).
 */
export function ufFromIbge(code: string): string | null {
  if (!/^\d{7}$/.test(code)) return null;
  return IBGE_PREFIX_TO_UF[code.slice(0, 2)] ?? null;
}
