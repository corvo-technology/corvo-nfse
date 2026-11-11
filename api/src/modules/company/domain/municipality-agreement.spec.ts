import {
  agreementView,
  currentAgreement,
  isAgreementStale,
  type MunicipalityAgreementAnswer,
} from './municipality-agreement';

const answer = (
  over: Partial<MunicipalityAgreementAnswer> = {},
): MunicipalityAgreementAnswer => ({
  municipalityCode: '3550308',
  found: true,
  agreementType: '1',
  nationalEnvironment: '1',
  ...over,
});
const checkedAt = new Date('2026-11-10T12:00:00Z');

describe('agreementView', () => {
  it('is not_checked without a stored answer', () => {
    expect(agreementView(null)).toEqual({
      status: 'not_checked',
      checkedAt: null,
      agreementType: null,
    });
  });

  it.each([
    [{ nationalEnvironment: '1' }, 'active'],
    [{ nationalEnvironment: '0' }, 'inactive'],
    [{ nationalEnvironment: '-1' }, 'unknown'],
    [{ found: false }, 'not_found'],
  ] as const)('maps %j to %s', (over, status) => {
    const view = agreementView({ answer: answer(over), checkedAt });
    expect(view.status).toBe(status);
    expect(view.checkedAt).toBe(checkedAt.toISOString());
  });
});

describe('currentAgreement', () => {
  it('ignores an answer about another municipality', () => {
    const stored = { answer: answer(), checkedAt };
    expect(currentAgreement(stored, '3550308')).toBe(stored);
    expect(currentAgreement(stored, '3304557')).toBeNull();
    expect(currentAgreement(stored, undefined)).toBeNull();
  });
});

describe('isAgreementStale', () => {
  const stored = { answer: answer(), checkedAt };
  it('is stale after 24 hours or when nothing is stored', () => {
    expect(isAgreementStale(null, checkedAt)).toBe(true);
    expect(isAgreementStale(stored, new Date('2026-11-11T11:59:00Z'))).toBe(
      false,
    );
    expect(isAgreementStale(stored, new Date('2026-11-11T12:01:00Z'))).toBe(
      true,
    );
  });
});
