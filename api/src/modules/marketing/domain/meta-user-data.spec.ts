import { createHash } from 'crypto';
import {
  buildMetaUserData,
  normalizeEmailForHashing,
  normalizePhoneForHashing,
} from './meta-user-data';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('normalizeEmailForHashing', () => {
  it('trims whitespace and lowercases the email before hashing', () => {
    expect(normalizeEmailForHashing('  Pedro@Example.COM  ')).toBe(
      'pedro@example.com',
    );
  });
});

describe('normalizePhoneForHashing', () => {
  it('keeps only digits and prepends the 55 DDI when missing', () => {
    expect(normalizePhoneForHashing('(11) 98765-4321')).toBe('5511987654321');
  });

  it('does not double the DDI when it is already present', () => {
    expect(normalizePhoneForHashing('+55 11 98765-4321')).toBe('5511987654321');
  });
});

describe('buildMetaUserData', () => {
  it('hashes the normalized email and the internal user id', () => {
    const result = buildMetaUserData({
      email: '  Pedro@Example.COM  ',
      authUserId: 'user-123',
    });
    expect(result.em).toEqual([sha256('pedro@example.com')]);
    expect(result.external_id).toEqual([sha256('user-123')]);
  });

  it('includes fbp/fbc/ip/user-agent only when provided', () => {
    const withExtras = buildMetaUserData({
      email: 'a@b.com',
      authUserId: 'id',
      fbp: 'fb.1.111.222',
      fbc: 'fb.1.111.333',
      clientIp: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
    expect(withExtras.fbp).toBe('fb.1.111.222');
    expect(withExtras.fbc).toBe('fb.1.111.333');
    expect(withExtras.client_ip_address).toBe('203.0.113.5');
    expect(withExtras.client_user_agent).toBe('Mozilla/5.0');

    const withoutExtras = buildMetaUserData({
      email: 'a@b.com',
      authUserId: 'id',
    });
    expect(withoutExtras.fbp).toBeUndefined();
    expect(withoutExtras.fbc).toBeUndefined();
    expect(withoutExtras.client_ip_address).toBeUndefined();
    expect(withoutExtras.client_user_agent).toBeUndefined();
  });

  it('never includes a CPF/CNPJ field, by construction', () => {
    const result = buildMetaUserData({ email: 'a@b.com', authUserId: 'id' });
    const keys = Object.keys(result);
    expect(keys).not.toContain('cpf');
    expect(keys).not.toContain('cnpj');
    expect(JSON.stringify(result)).not.toMatch(/cpf|cnpj/i);
  });
});
