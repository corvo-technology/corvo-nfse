import { parseEnvConfig } from './env.schema';

describe('nfse emission environment configuration', () => {
  it('sends three invoices at once by default', () => {
    expect(parseEnvConfig({ NODE_ENV: 'test' }).NFSE_EMISSION_CONCURRENCY).toBe(
      3,
    );
  });

  it('accepts an override between 1 and 10 and rejects anything else', () => {
    expect(
      parseEnvConfig({ NODE_ENV: 'test', NFSE_EMISSION_CONCURRENCY: '5' })
        .NFSE_EMISSION_CONCURRENCY,
    ).toBe(5);
    for (const invalid of ['0', '11', 'abc'])
      expect(() =>
        parseEnvConfig({
          NODE_ENV: 'test',
          NFSE_EMISSION_CONCURRENCY: invalid,
        }),
      ).toThrow();
  });
});
