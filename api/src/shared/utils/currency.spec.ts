import { formatBrl } from './currency';

describe('formatBrl', () => {
  it('formats with thousands separator and two decimals', () => {
    expect(formatBrl(1250)).toBe('R$ 1.250,00');
  });

  it('formats cents', () => {
    expect(formatBrl(0.5)).toBe('R$ 0,50');
  });

  it('formats zero', () => {
    expect(formatBrl(0)).toBe('R$ 0,00');
  });
});
