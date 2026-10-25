import { ConfigService } from '@nestjs/config';
import { RolloutFlagsService } from '@/shared/rollout/rollout-flags.service';
import { TaxRegimeNotSupportedError } from './errors';
import { assertRegimeSupported } from './tax-regime-support';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const flags = (on: boolean, tenants: '*' | string[] = '*') =>
  new RolloutFlagsService(
    new ConfigService({
      rollout: {
        taxRegimeRestriction: { on, tenants },
        fiscalDpsConformance: { on: false, tenants: '*' },
        simplesTottrib: { on: false, tenants: '*' },
        fiscal2027SimplesMei: { on: false, tenants: '*' },
        cnpjRegistryCheck: { on: false, tenants: '*' },
        simplesRateMode: { mode: 'off', tenants: '*' },
        simplesRateEnforcedFrom: null,
      },
    }),
  );

describe('assertRegimeSupported', () => {
  it.each([
    'LUCRO_PRESUMIDO',
    'LUCRO_REAL',
    'OUTRO_REGIME',
    'UNKNOWN',
  ] as const)('refuses %s when the restriction is on', (regime) => {
    expect(() => assertRegimeSupported(flags(true), A, regime)).toThrow(
      TaxRegimeNotSupportedError,
    );
  });

  it.each(['MEI', 'SIMPLES_NACIONAL'] as const)(
    'accepts %s when the restriction is on',
    (regime) => {
      expect(() => assertRegimeSupported(flags(true), A, regime)).not.toThrow();
    },
  );

  it('accepts everything when the flag is off, absent or the tenant is not listed', () => {
    expect(() =>
      assertRegimeSupported(flags(false), A, 'LUCRO_REAL'),
    ).not.toThrow();
    expect(() =>
      assertRegimeSupported(undefined, A, 'LUCRO_REAL'),
    ).not.toThrow();
    expect(() =>
      assertRegimeSupported(flags(true, [B]), A, 'LUCRO_REAL'),
    ).not.toThrow();
  });
});
