import { CookiePolicyService } from './cookie-policy.service';
import { ConfigService } from '@nestjs/config';

describe('CookiePolicyService', () => {
  it('uses __Host cookies with the required production attributes', () => {
    const policy = new CookiePolicyService();
    expect(policy.name('session')).toBe('__Host-gf_session');
    expect(policy.options()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('uses secure host-only cookies in every environment', () => {
    const policy = new CookiePolicyService();
    expect(policy.name('session')).toBe('__Host-gf_session');
    expect(policy.options()).toMatchObject({ secure: true });
  });

  it('supports HTTP development while keeping production cookies secure', () => {
    const local = new CookiePolicyService(
      new ConfigService({ app: { nodeEnv: 'development' } }),
    );
    expect(local.name('session')).toBe('gf_session_dev');
    expect(local.options()).toMatchObject({
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    const production = new CookiePolicyService(
      new ConfigService({ app: { nodeEnv: 'production' } }),
    );
    expect(production.name('session')).toBe('__Host-gf_session');
    expect(production.options()).toMatchObject({ secure: true });
  });
});
