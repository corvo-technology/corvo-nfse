import { resolveDpsLayout, DEFAULT_NT009_CUTOVER_AT } from './dps-layout';

describe('resolveDpsLayout', () => {
  it.each([
    ['auto', 'production', '2026-11-30T23:59:59-03:00', 'rtc-v1.01'],
    ['auto', 'production', '2026-12-01T02:59:59Z', 'rtc-v1.01'],
    ['auto', 'production', '2026-12-01T00:00:00-03:00', 'nt009-r1'],
    ['auto', 'production', '2026-12-01T03:00:00Z', 'nt009-r1'],
    ['auto', 'restricted', '2026-11-30T23:59:59-03:00', 'nt009-r1'],
    ['auto', 'restricted', '2026-12-01T00:00:00-03:00', 'nt009-r1'],
    ['rtc-v1.01', 'restricted', '2026-12-02T00:00:00-03:00', 'rtc-v1.01'],
    ['nt009-r1', 'restricted', '2026-11-30T23:59:59-03:00', 'nt009-r1'],
  ] as const)(
    '%s / %s / %s -> %s',
    (configured, sefinEnvironment, at, expected) => {
      expect(
        resolveDpsLayout({
          configured,
          sefinEnvironment,
          cutoverAt: DEFAULT_NT009_CUTOVER_AT,
          at: new Date(at),
        }),
      ).toBe(expected);
    },
  );
  it('honors a custom cutover', () => {
    expect(
      resolveDpsLayout({
        configured: 'auto',
        sefinEnvironment: 'production',
        cutoverAt: '2027-01-01T00:00:00-03:00',
        at: new Date(DEFAULT_NT009_CUTOVER_AT),
      }),
    ).toBe('rtc-v1.01');
  });
});
