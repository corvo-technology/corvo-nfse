/**
 * Default service code (cTribNac) suggested by the main activity (CNAE) of a company.
 *
 * There is no official CNAE x cTribNac table in the repo, and the same CNAE can fall under more than one
 * LC 116 item, so this is deliberately small: only CNAE subclasses whose name is the same service as one
 * LC 116 sub-item of the national catalog. The CNAE never decides anything: forms and agents only suggest
 * the code and the person confirms it. A CNAE that is not listed here gets no suggestion.
 *
 * Left out on purpose because they fit more than one item: 6201-5/01 and 6202-3/00 (1.01 or 1.04),
 * 6311-9/00 (1.03), 8650-0/03 (4.15 or 4.16), civil construction and trade.
 */
export const CNAE_SERVICE_CODES: Readonly<Record<string, string>> = {
  // LC 116 item 1 (informática)
  '6203100': '010501', // Desenvolvimento e licenciamento de programas de computador não-customizáveis
  '6204000': '010601', // Consultoria em tecnologia da informação
  '6209100': '010701', // Suporte técnico, manutenção e outros serviços em tecnologia da informação
  // Items 4 and 5 (saúde, veterinária)
  '8630504': '041201', // Atividade odontológica
  '8650004': '040802', // Atividades de fisioterapia
  '7500100': '050101', // Atividades veterinárias
  // Item 6 (cuidados pessoais, estética, atividades físicas)
  '9602501': '060101', // Cabeleireiros, manicure e pedicure
  '9602502': '060201', // Atividades de estética e outros serviços de cuidados com a beleza
  '9313100': '060401', // Atividades de condicionamento físico
  // Item 7 (engenharia)
  '7112000': '070101', // Serviços de engenharia
  // Item 8 (ensino)
  '8599603': '080201', // Treinamento em informática
  '8599604': '080201', // Treinamento em desenvolvimento profissional e gerencial
  // Item 10 (intermediação)
  '7490104': '100901', // Atividades de intermediação e agenciamento de serviços e negócios em geral
  // Item 13 (fotografia)
  '7420001': '130301', // Atividades de produção de fotografias, exceto aérea e submarina
  // Item 14 (manutenção)
  '4520001': '140101', // Serviços de manutenção e reparação mecânica de veículos automotores
  // Item 17 (apoio técnico e administrativo)
  '7311400': '170601', // Agências de publicidade
  '6911701': '171401', // Serviços advocatícios
  '6920601': '171901', // Atividades de contabilidade
};

/** The cTribNac suggested for a CNAE (7 digits, punctuation ignored), or null when there is no sure match. */
export function suggestServiceCode(cnae: string): string | null {
  return CNAE_SERVICE_CODES[cnae.replace(/\D/g, '')] ?? null;
}
