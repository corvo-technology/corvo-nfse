import { parseEnvConfig } from './env.schema';

describe('FISCAL_HTTPS_PROXY configuration', () => {
  it('is optional', () => {
    expect(
      parseEnvConfig({ NODE_ENV: 'test' }).FISCAL_HTTPS_PROXY,
    ).toBeUndefined();
  });

  it('accepts an http(s) url with credentials', () => {
    const url = 'http://user:pass@proxy.example.com:3128';
    expect(
      parseEnvConfig({ NODE_ENV: 'test', FISCAL_HTTPS_PROXY: url })
        .FISCAL_HTTPS_PROXY,
    ).toBe(url);
  });

  it.each(['not a url', 'socks5://proxy.example.com:1080'])(
    'rejects %s',
    (value) => {
      expect(() =>
        parseEnvConfig({ NODE_ENV: 'test', FISCAL_HTTPS_PROXY: value }),
      ).toThrow();
    },
  );
});
