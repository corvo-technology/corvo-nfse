import { friendlyRejectionReason } from './rejection-reason-text';

describe('friendlyRejectionReason', () => {
  it.each([
    ['E0014', 'próximo número'],
    ['DPS_NUMBER_ALREADY_USED', 'próximo número'],
    ['DPS_NUMBERING_NEEDS_CONFIRMATION', 'Aumente a numeração'],
    ['E0120', 'Inscrição Municipal'],
    ['E0015', 'data da nota está no futuro'],
    ['E0174', 'regime'],
    ['SIMPLES_RATE_STALE', 'alíquota do Simples'],
    ['CERTIFICATE_EXPIRED', 'certificado digital'],
    ['TAX_RATE_NOT_FOUND', 'alíquota'],
    ['EMISSION_PROCESSING_FAILED', 'Tente emitir de novo'],
    ['DISCARDED_AFTER_REVIEW', 'descartada'],
  ])('explains %s in plain Portuguese', (code, expected) => {
    const text = friendlyRejectionReason(code, 'mensagem técnica qualquer');
    expect(text).toContain(expected);
    expect(text).not.toContain('mensagem técnica');
  });

  it('reads the code from a lower-case value', () => {
    expect(friendlyRejectionReason('e0120', null)).toContain(
      'Inscrição Municipal',
    );
  });

  it('finds the code inside the portal message when the invoice has none', () => {
    expect(
      friendlyRejectionReason(
        null,
        'Rejeição da Receita [E0120]: IM do prestador não deve ser informado',
      ),
    ).toContain('Inscrição Municipal');
  });

  it('keeps the authority sentence for a Receita code without a known fix', () => {
    expect(
      friendlyRejectionReason(
        'E0999',
        'Rejeição da Receita [E0999]: CEP do tomador não encontrado.',
      ),
    ).toBe('CEP do tomador não encontrado.');
  });

  it('cuts a very long authority sentence', () => {
    const long = `Rejeição da Receita [E0999]: ${'a'.repeat(500)}`;
    const text = friendlyRejectionReason('E0999', long);
    expect(text.length).toBeLessThanOrEqual(280);
    expect(text.endsWith('…')).toBe(true);
  });

  it('never shows our own English text', () => {
    const text = friendlyRejectionReason(
      'SOMETHING_NEW',
      'Emission could not be completed: socket hang up',
    );
    expect(text).not.toContain('socket');
    expect(text).toContain('Abra a nota');
  });

  it('has a generic answer without code or message', () => {
    expect(friendlyRejectionReason(undefined, undefined)).toContain(
      'Abra a nota',
    );
  });
});
