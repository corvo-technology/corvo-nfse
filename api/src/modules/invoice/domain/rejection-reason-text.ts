/**
 * Why a note was rejected, in plain Portuguese for the e-mail to the owner. Our own error codes and
 * the Receita codes that have a known fix get a short text with what to do; any other Receita code
 * keeps the authority's own sentence (already cleaned of internal details by the provider).
 */
const FRIENDLY: Record<string, string> = {
  E0014:
    'Esse número de nota já tinha sido usado no portal do governo. Ajuste o próximo número nas configurações da empresa.',
  DPS_NUMBER_ALREADY_USED:
    'Esse número de nota já tinha sido usado no portal do governo. Ajuste o próximo número nas configurações da empresa.',
  DPS_NUMBERING_NEEDS_CONFIRMATION:
    'Os próximos números de nota já foram usados no governo para este CNPJ. Aumente a numeração nas configurações da empresa.',
  DPS_USED_BY_OTHER_NFSE:
    'O número desta nota já pertence a outra nota no governo. Confira o portal e emita de novo.',
  E0120:
    'O município não aceita a Inscrição Municipal da empresa nesta nota. Tire esse número do cadastro da empresa.',
  E0015:
    'A data da nota está no futuro. Use a data de hoje ou agende a emissão.',
  E0174:
    'O regime especial de tributação não combina com o regime da empresa (MEI ou Simples Nacional). Confira o cadastro da empresa.',
  E0175:
    'O regime especial de tributação não combina com o regime da empresa (MEI ou Simples Nacional). Confira o cadastro da empresa.',
  SIMPLES_RATE_STALE:
    'A alíquota do Simples Nacional da empresa está desatualizada. Atualize na página da empresa.',
  CERTIFICATE_EXPIRED:
    'O certificado digital da empresa venceu. Envie um novo certificado.',
  CERTIFICATE_NOT_FOUND:
    'A empresa não tem certificado digital válido. Envie o certificado para emitir.',
  FISCAL_CLASSIFICATION_REQUIRED:
    'Falta o código de tributação do serviço. Escolha o serviço certo e emita de novo.',
  CLASSIFICATION_MISSING:
    'Falta o código de tributação do serviço. Escolha o serviço certo e emita de novo.',
  TAX_CALCULATION_UNAVAILABLE:
    'Não conseguimos calcular os impostos desta nota agora. Confira o serviço e o cadastro da empresa e tente de novo.',
  TAX_RATE_NOT_FOUND:
    'Não achamos a alíquota deste serviço. Confira o código do serviço e o cadastro da empresa.',
  FISCAL_PROFILE_MISSING:
    'Falta completar o cadastro fiscal da empresa. Abra a empresa e preencha os dados que faltam.',
  FISCAL_PROFILE_NOT_EFFECTIVE:
    'O cadastro fiscal da empresa ainda não está valendo para esta data. Confira o cadastro da empresa.',
  FISCAL_VALIDATION_FAILED:
    'Algum dado da nota não passou na conferência. Abra a nota e confira cliente e serviço.',
  DPS_SCHEMA_INVALID:
    'Algum dado da nota está num formato que o governo não aceita. Abra a nota e confira cliente e serviço.',
  EMISSION_PROCESSING_FAILED:
    'Não conseguimos concluir a emissão agora, por um problema nosso ou do portal. Tente emitir de novo.',
  DISCARDED_AFTER_REVIEW:
    'A nota não chegou a ser registrada no governo e foi descartada. Emita de novo.',
};

const GENERIC =
  'O governo não aceitou os dados desta nota. Abra a nota para ver o detalhe e corrigir.';
const MAX_LENGTH = 280;

/** A Receita code is a letter E and four digits. */
const isReceitaCode = (code: string): boolean => /^E\d{4}$/.test(code);

/** "Rejeição da Receita [E0999]: texto" -> "texto". */
function authorityText(message: string): string {
  return message.replace(/^Rejeição da Receita \[E\d{4}\]:\s*/, '').trim();
}

export function friendlyRejectionReason(
  code: string | null | undefined,
  message: string | null | undefined,
): string {
  const key =
    (code ?? '').trim().toUpperCase() ||
    (/\[(E\d{4})\]/.exec(message ?? '')?.[1] ?? '');
  const known = FRIENDLY[key];
  if (known) return known;
  const text = authorityText(message ?? '');
  // Only the authority's own Portuguese sentence is shown; our internal English text never is.
  if (isReceitaCode(key) && text)
    return text.length > MAX_LENGTH
      ? `${text.slice(0, MAX_LENGTH - 1)}…`
      : text;
  return GENERIC;
}
