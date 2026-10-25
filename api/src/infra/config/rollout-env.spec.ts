import { parseEnvConfig } from './env.schema';

const base = { NODE_ENV: 'test' };
const TENANT = '11111111-1111-4111-8111-111111111111';

describe('rollout environment configuration', () => {
  it('has every flag off by default', () => {
    const env = parseEnvConfig(base);
    expect(env.TAX_REGIME_RESTRICTION).toBe(false);
    expect(env.FISCAL_DPS_CONFORMANCE).toBe(false);
    expect(env.SIMPLES_TOTTRIB).toBe(false);
    expect(env.FISCAL_2027_SIMPLES_MEI).toBe(false);
    expect(env.CNPJ_REGISTRY_CHECK).toBe(false);
    expect(env.SIMPLES_RATE_MODE).toBe('off');
    expect(env.SIMPLES_RATE_ENFORCED_FROM).toBeUndefined();
  });

  it('accepts on/true values and the three rate modes', () => {
    expect(
      parseEnvConfig({ ...base, FISCAL_DPS_CONFORMANCE: 'true' })
        .FISCAL_DPS_CONFORMANCE,
    ).toBe(true);
    for (const mode of ['off', 'warn', 'block'])
      expect(
        parseEnvConfig({ ...base, SIMPLES_RATE_MODE: mode }).SIMPLES_RATE_MODE,
      ).toBe(mode);
  });

  it('rejects an unknown rate mode and a malformed enforcement date', () => {
    expect(() =>
      parseEnvConfig({ ...base, SIMPLES_RATE_MODE: 'strict' }),
    ).toThrow();
    expect(() =>
      parseEnvConfig({ ...base, SIMPLES_RATE_ENFORCED_FROM: '2026-13-99' }),
    ).toThrow();
    expect(() =>
      parseEnvConfig({ ...base, SIMPLES_RATE_ENFORCED_FROM: '01/11/2026' }),
    ).toThrow();
  });

  it('treats an empty enforcement date as not set', () => {
    expect(
      parseEnvConfig({ ...base, SIMPLES_RATE_ENFORCED_FROM: '' })
        .SIMPLES_RATE_ENFORCED_FROM,
    ).toBeUndefined();
    expect(
      parseEnvConfig({ ...base, SIMPLES_RATE_ENFORCED_FROM: '2026-11-01' })
        .SIMPLES_RATE_ENFORCED_FROM,
    ).toBe('2026-11-01');
  });

  it('accepts a tenant list or * and rejects a malformed tenant id', () => {
    expect(
      parseEnvConfig({
        ...base,
        FISCAL_DPS_CONFORMANCE_TENANTS: `${TENANT}, *`,
      }).FISCAL_DPS_CONFORMANCE_TENANTS,
    ).toContain(TENANT);
    expect(() =>
      parseEnvConfig({ ...base, FISCAL_DPS_CONFORMANCE_TENANTS: 'not-a-uuid' }),
    ).toThrow();
  });
});
