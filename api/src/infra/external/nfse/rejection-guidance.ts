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
    'Essa empresa já emitiu notas com esse número em outro sistema ou no Portal Nacional. Informe o número da última nota emitida (campo "Numeração das notas" na empresa, ou PUT /companies/{id}/dps-sequence) e emita novamente.',
  ],
];

export function explainRejection(message: string): string {
  const hint = GUIDANCE.find(([pattern]) => pattern.test(message))?.[1];
  return hint ? `${message} ${hint}` : message;
}
