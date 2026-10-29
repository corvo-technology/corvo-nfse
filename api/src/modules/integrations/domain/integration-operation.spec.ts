import { mergeCommercialState } from './integration-operation';

describe('mergeCommercialState', () => {
  it('advances pending -> paid -> disputed -> refunded', () => {
    expect(mergeCommercialState('pending', 'paid')).toBe('paid');
    expect(mergeCommercialState('paid', 'disputed')).toBe('disputed');
    expect(mergeCommercialState('disputed', 'refunded')).toBe('refunded');
  });
  it('never goes back', () => {
    expect(mergeCommercialState('refunded', 'paid')).toBe('refunded');
    expect(mergeCommercialState('refunded', 'disputed')).toBe('refunded');
    expect(mergeCommercialState('disputed', 'paid')).toBe('disputed');
    expect(mergeCommercialState('paid', 'pending')).toBe('paid');
  });
  it('canceled is final, and only a pending operation can become canceled', () => {
    expect(mergeCommercialState('canceled', 'paid')).toBe('canceled');
    expect(mergeCommercialState('pending', 'canceled')).toBe('canceled');
    expect(mergeCommercialState('paid', 'canceled')).toBe('paid');
  });
});
