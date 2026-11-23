import { parseEnvConfig } from './env.schema';

describe('PLATFORM_ADMIN_EMAILS', () => {
  const base = { NODE_ENV: 'test' };

  it('aceita a lista de e-mails', () => {
    expect(
      parseEnvConfig({ ...base, PLATFORM_ADMIN_EMAILS: 'a@b.com' })
        .PLATFORM_ADMIN_EMAILS,
    ).toBe('a@b.com');
  });

  it('ausente fica indefinido', () => {
    expect(parseEnvConfig(base).PLATFORM_ADMIN_EMAILS).toBeUndefined();
  });
});
