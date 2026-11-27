import {
  normalizeStateRegistration,
  validateStateRegistration,
} from './state-registration';

describe('validateStateRegistration', () => {
  it('accepts a valid São Paulo IE, with or without punctuation', () => {
    expect(validateStateRegistration('SP', '110042490114')).toBe(true);
    expect(validateStateRegistration('SP', '110.042.490.114')).toBe(true);
  });

  it('rejects a São Paulo IE with a wrong check digit', () => {
    expect(validateStateRegistration('SP', '110042490115')).toBe(false);
    expect(validateStateRegistration('SP', '110042491114')).toBe(false);
  });

  it('rejects ISENTO and non-numeric values for an issuer', () => {
    expect(validateStateRegistration('SP', 'ISENTO')).toBe(false);
    expect(validateStateRegistration('MG', 'ISENTO')).toBe(false);
    expect(validateStateRegistration('SP', 'P011004243002')).toBe(false);
  });

  it('checks only the length for the other UFs', () => {
    expect(validateStateRegistration('MG', '0623079040081')).toBe(true);
    expect(validateStateRegistration('MG', '062307904008')).toBe(false);
    expect(validateStateRegistration('RS', '0170019641')).toBe(true);
    expect(validateStateRegistration('RS', '017001964')).toBe(false);
  });

  it('knows the length rule of every UF', () => {
    expect(validateStateRegistration('BA', '12345678')).toBe(true);
    expect(validateStateRegistration('BA', '123456789')).toBe(true);
    expect(validateStateRegistration('BA', '1234567')).toBe(false);
  });
});

describe('normalizeStateRegistration', () => {
  it('keeps the digits only', () => {
    expect(normalizeStateRegistration('110.042.490.114')).toBe('110042490114');
  });
});
