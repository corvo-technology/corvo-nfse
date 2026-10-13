import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { parseEnvConfig } from './env.schema';

describe('email environment configuration', () => {
  it('loads email credentials from an env file through Nest validation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'corvo-email-env-'));
    const envFile = join(directory, '.env');
    const originalEnvironment = { ...process.env };
    const expected = {
      RESEND_API_KEY: 'ms_test_env_fixture',
      RESEND_BASE_URL: 'https://api.millionsend.com',
      EMAIL_FROM: 'Corvo <noreply@example.com>',
    };
    writeFileSync(
      envFile,
      [
        'NODE_ENV=test',
        ...Object.entries(expected).map(([key, value]) => `${key}=${value}`),
      ].join('\n'),
    );
    for (const key of Object.keys(expected)) delete process.env[key];

    try {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            envFilePath: envFile,
            ignoreEnvVars: true,
            validate: parseEnvConfig,
          }),
        ],
      }).compile();
      try {
        const config = module.get(ConfigService);
        for (const [key, value] of Object.entries(expected)) {
          expect(config.get(key)).toBe(value);
          expect(process.env[key]).toBe(value);
        }
      } finally {
        await module.close();
      }
    } finally {
      process.env = originalEnvironment;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('allows local configuration without email credentials', () => {
    expect(parseEnvConfig({ NODE_ENV: 'test' })).not.toHaveProperty(
      'RESEND_API_KEY',
    );
  });

  it('rejects an invalid email API base URL', () => {
    expect(() =>
      parseEnvConfig({
        NODE_ENV: 'test',
        RESEND_BASE_URL: 'invalid-url',
      }),
    ).toThrow();
  });
});
