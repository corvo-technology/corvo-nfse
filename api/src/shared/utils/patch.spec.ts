import { omitNullish, omitUndefined } from './patch';

describe('patch utilities', () => {
  it('omits only undefined values from patches', () => {
    expect(
      omitUndefined({
        omitted: undefined,
        cleared: null,
        disabled: false,
        count: 0,
        text: '',
      }),
    ).toEqual({
      cleared: null,
      disabled: false,
      count: 0,
      text: '',
    });
  });

  it('keeps omitNullish semantics distinct', () => {
    expect(
      omitNullish({ omitted: undefined, cleared: null, disabled: false }),
    ).toEqual({ disabled: false });
  });
});
