import { parseEnvConfig } from './env.schema';

describe('NF-e environment configuration', () => {
  it('is off, homologation-only and on SEFAZ by default', () => {
    const env = parseEnvConfig({ NODE_ENV: 'test' });
    expect(env.NFE_ENABLED).toBe(false);
    expect(env.NFE_PRODUCTION_ENABLED).toBe(false);
    expect(env.NFE_TEST_PROVIDER).toBe('sefaz');
    expect(env.NFE_SEFAZ_TIMEOUT_MS).toBe(30000);
  });

  it('accepts the flags and the simulator', () => {
    const env = parseEnvConfig({
      NODE_ENV: 'test',
      NFE_ENABLED: 'true',
      NFE_PRODUCTION_ENABLED: '1',
      NFE_TEST_PROVIDER: 'fake',
      NFE_SEFAZ_TIMEOUT_MS: '5000',
    });
    expect(env).toMatchObject({
      NFE_ENABLED: true,
      NFE_PRODUCTION_ENABLED: true,
      NFE_TEST_PROVIDER: 'fake',
      NFE_SEFAZ_TIMEOUT_MS: 5000,
    });
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', NFE_TEST_PROVIDER: 'sefin' }),
    ).toThrow();
  });
});
