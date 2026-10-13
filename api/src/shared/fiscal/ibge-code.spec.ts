import { isValidIbgeCode } from './ibge-code';

describe('ibge code', () => {
  it('accepts 7 digits', () => expect(isValidIbgeCode('5300108')).toBe(true));
  it.each(['', '530010', '53001080', '53001a8', ' 5300108'])(
    'rejects %p',
    (v) => expect(isValidIbgeCode(v)).toBe(false),
  );
});
