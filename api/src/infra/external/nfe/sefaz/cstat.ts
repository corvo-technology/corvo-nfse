export type CstatClass =
  | 'authorized'
  | 'denied'
  | 'duplicate'
  | 'not_found'
  | 'unavailable'
  | 'rejected'
  | 'processing';

/**
 * cStat of the authorization/consultation answers. Codes and wording follow the MOC as mirrored in
 * sped-nfe `storage/cstat.json` (2026-11-23); the exact set the SEFAZ returns is [verificar no
 * spike].
 */
const CLASSES: Record<string, CstatClass> = {
  '100': 'authorized',
  '150': 'authorized',
  '110': 'denied',
  '301': 'denied',
  '302': 'denied',
  '303': 'denied',
  '204': 'duplicate',
  '217': 'not_found',
  '108': 'unavailable',
  '109': 'unavailable',
  '103': 'processing',
  '105': 'processing',
};

export function classifyCstat(cStat: string): CstatClass {
  return Object.hasOwn(CLASSES, cStat) ? CLASSES[cStat] : 'rejected';
}

/** Official wording of the codes the simulator and the first rejections use. */
export const CSTAT_MESSAGES: Record<string, string> = {
  '100': 'Autorizado o uso da NF-e',
  '103': 'Lote recebido com sucesso',
  '105': 'Lote em processamento',
  '107': 'Serviço em Operação',
  '108': 'Serviço Paralisado Momentaneamente (curto prazo)',
  '109': 'Serviço Paralisado sem Previsão',
  '102': 'Inutilização de número homologado',
  '135': 'Evento registrado e vinculado a NF-e',
  '204': 'Duplicidade de NF-e',
  '217': 'Rejeição: NF-e não consta na base de dados da SEFAZ',
  '225': 'Rejeição: Falha no Schema XML do lote de NFe',
  '302': 'Uso Denegado: Irregularidade fiscal do destinatário',
  '539': 'Duplicidade de NF-e com diferença na Chave de Acesso',
  '563':
    'Rejeição: Já existe pedido de inutilização com a mesma faixa de numeração',
  '573': 'Rejeição: Duplicidade de Evento',
  '778': 'Rejeição: Informado NCM inexistente',
};

/** What the customer can do about a rejection (pt-BR), in the mold of the NFS-e rejection-guidance. */
export const REJECTION_HINTS: Record<string, string> = {
  '204':
    'Essa nota já foi autorizada. Consulte pela chave de acesso em vez de emitir de novo.',
  '225':
    'O XML não passou na validação de schema da SEFAZ. Confira textos com caracteres especiais e campos obrigatórios.',
  '539':
    'Já existe uma NF-e com esse número e outra chave. Consulte a nota antes de tentar de novo; o Corvo não reaproveita o número.',
  '778':
    'O NCM informado não existe na tabela vigente. Confirme o código com o contador.',
  // [verificar no spike]: the meaning of 897 is not in the mirrored table.
  '897':
    'A SEFAZ rejeitou a nota com o código 897. Leia a mensagem retornada e confirme os dados com o contador.',
};

export function explainCstat(cStat: string): string | undefined {
  return REJECTION_HINTS[cStat];
}
