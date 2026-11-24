/**
 * Receita rejection codes that have a known fix on our side. The original message is kept;
 * the guidance is appended so the user knows what to change.
 */
const GUIDANCE: [RegExp, string][] = [
  [
    /\bE0120\b/,
    'Remova a Inscrição Municipal do cadastro da empresa e emita novamente: o município não tem dados complementares dela no cadastro nacional.',
  ],
  [
    /\bE0014\b/,
    'Esse número de nota já foi usado (provavelmente no portal do governo). Ajuste o próximo número nas configurações da empresa e emita de novo.',
  ],
];

export function explainRejection(message: string): string {
  const hint = GUIDANCE.find(([pattern]) => pattern.test(message))?.[1];
  return hint ? `${message} ${hint}` : message;
}

/**
 * Our own code for the Receita rejections the customer can fix. Everything else keeps the
 * Receita's code (E0120 and the like), which is the authority's own wording.
 */
const OWN_CODES: [RegExp, string][] = [[/^E0014$/, 'DPS_NUMBER_ALREADY_USED']];

export function rejectionCode(codigo: string): string {
  return OWN_CODES.find(([pattern]) => pattern.test(codigo))?.[1] ?? codigo;
}
