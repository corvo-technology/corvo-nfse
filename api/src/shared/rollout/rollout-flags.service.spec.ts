import { ConfigService } from '@nestjs/config';
import { RolloutFlagsService } from './rollout-flags.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const off = { on: false, tenants: '*' as const };
const config = (overrides: Record<string, unknown> = {}) =>
  new ConfigService({
    rollout: {
      fiscalDpsConformance: off,
      simplesTottrib: off,
      cnpjRegistryCheck: off,
      simplesRateMode: { mode: 'off', tenants: '*' },
      simplesRateEnforcedFrom: null,
      ...overrides,
    },
  });

describe('RolloutFlagsService', () => {
  it('has every flag off by default', () => {
    const flags = new RolloutFlagsService(config());
    for (const flag of [
      'FISCAL_DPS_CONFORMANCE',
      'SIMPLES_TOTTRIB',
      'CNPJ_REGISTRY_CHECK',
    ] as const)
      expect(flags.isOn(flag, A)).toBe(false);
    expect(flags.rateMode(A)).toBe('off');
    expect(flags.rateEnforcedFrom()).toBeNull();
  });

  it('is on for every tenant when the flag is on and no tenant list is set', () => {
    const flags = new RolloutFlagsService(
      config({ fiscalDpsConformance: { on: true, tenants: '*' } }),
    );
    expect(flags.isOn('FISCAL_DPS_CONFORMANCE', A)).toBe(true);
    expect(flags.isOn('FISCAL_DPS_CONFORMANCE', B)).toBe(true);
  });

  it('limits a flag to the listed tenants', () => {
    const flags = new RolloutFlagsService(
      config({ simplesTottrib: { on: true, tenants: [A] } }),
    );
    expect(flags.isOn('SIMPLES_TOTTRIB', A)).toBe(true);
    expect(flags.isOn('SIMPLES_TOTTRIB', B)).toBe(false);
  });

  it('is off for everyone when the flag is off, even for listed tenants', () => {
    const flags = new RolloutFlagsService(
      config({ simplesTottrib: { on: false, tenants: [A] } }),
    );
    expect(flags.isOn('SIMPLES_TOTTRIB', A)).toBe(false);
  });

  it('applies the rate mode only to allowed tenants', () => {
    const flags = new RolloutFlagsService(
      config({ simplesRateMode: { mode: 'block', tenants: [A] } }),
    );
    expect(flags.rateMode(A)).toBe('block');
    expect(flags.rateMode(B)).toBe('off');
  });

  it('returns the enforcement date', () => {
    const flags = new RolloutFlagsService(
      config({ simplesRateEnforcedFrom: '2026-11-01' }),
    );
    expect(flags.rateEnforcedFrom()).toBe('2026-11-01');
  });
});
