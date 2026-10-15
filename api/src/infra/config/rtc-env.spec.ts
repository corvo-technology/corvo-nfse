import { parseEnvConfig } from './env.schema';

describe('rtc environment configuration', () => {
  it('applies defaults', () => {
    const env = parseEnvConfig({ NODE_ENV: 'test' });
    expect(env.RTC_CALCULATOR_URL).toBeUndefined();
    expect(env.RTC_CALCULATOR_TIMEOUT_MS).toBe(8000);
    expect(env.RTC_CALCULATOR_MAX_CONCURRENCY).toBe(8);
    expect(env.RTC_CIRCUIT_FAILURE_THRESHOLD).toBe(5);
    expect(env.RTC_CIRCUIT_RESET_MS).toBe(30000);
    expect(env.FISCAL_DPS_LAYOUT).toBe('rtc-v1.01');
  });

  it('coerces overrides and rejects invalid values', () => {
    const env = parseEnvConfig({
      NODE_ENV: 'test',
      RTC_CALCULATOR_URL: 'http://rtc-calculator:8080/api',
      RTC_CALCULATOR_TIMEOUT_MS: '5000',
      RTC_CALCULATOR_MAX_CONCURRENCY: '4',
      RTC_CIRCUIT_FAILURE_THRESHOLD: '3',
      RTC_CIRCUIT_RESET_MS: '15000',
      FISCAL_DPS_LAYOUT: 'rtc-v1.01',
    });
    expect(env.RTC_CALCULATOR_URL).toBe('http://rtc-calculator:8080/api');
    expect(env.RTC_CALCULATOR_TIMEOUT_MS).toBe(5000);
    expect(env.RTC_CALCULATOR_MAX_CONCURRENCY).toBe(4);
    expect(env.RTC_CIRCUIT_FAILURE_THRESHOLD).toBe(3);
    expect(env.RTC_CIRCUIT_RESET_MS).toBe(15000);
    expect(env.FISCAL_DPS_LAYOUT).toBe('rtc-v1.01');

    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', RTC_CALCULATOR_TIMEOUT_MS: '0' }),
    ).toThrow();
    expect(() =>
      parseEnvConfig({
        NODE_ENV: 'test',
        RTC_CALCULATOR_MAX_CONCURRENCY: '-1',
      }),
    ).toThrow();
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', FISCAL_DPS_LAYOUT: 'rtc-v1.04' }),
    ).toThrow();
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', RTC_CALCULATOR_URL: 'not-a-url' }),
    ).toThrow();
  });
});
