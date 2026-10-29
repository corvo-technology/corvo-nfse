import { CredentialsService } from './credentials.service';
import type { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';

const cipher = {
  encrypt: (s: string) => Buffer.from(`x${s}`).toString('base64'),
  decrypt: (s: string) => Buffer.from(s, 'base64').toString().slice(1),
} as unknown as SecretsCipherService;

describe('CredentialsService', () => {
  it('seals without exposing the plaintext and opens back to the same object', () => {
    const service = new CredentialsService(cipher);
    const sealed = service.seal({ appId: 'super-secret' });
    expect(sealed).not.toContain('super-secret');
    expect(service.open(sealed)).toEqual({ appId: 'super-secret' });
  });
});
