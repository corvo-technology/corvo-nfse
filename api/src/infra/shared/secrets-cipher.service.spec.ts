import { ConfigService } from '@nestjs/config';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';

const VALID_KEY = 'dGVzdC1zZWNyZXRzLWtleS0zMi1ieXRlcy0xMjM0NTY=';

function makeCipher(key = VALID_KEY) {
  return new SecretsCipherService({
    getOrThrow: jest.fn(() => ({ secretsEncryptionKey: key })),
  } as unknown as ConfigService);
}

describe('SecretsCipherService', () => {
  it('encrypts and decrypts secrets with AES-256-GCM', () => {
    const cipher = makeCipher();

    const encrypted = cipher.encrypt('meta-token');

    expect(encrypted).not.toBe('meta-token');
    expect(cipher.decrypt(encrypted)).toBe('meta-token');
  });

  it('decrypts legacy hex encoded AES-256-GCM payloads', () => {
    const cipher = makeCipher();
    const encrypted = cipher.encrypt('meta-token');
    const hex = Buffer.from(encrypted, 'base64').toString('hex');
    const legacy = `\n  \\x${hex.slice(0, 120)}\n  ${hex.slice(120)}\n`;

    expect(cipher.decrypt(legacy)).toBe('meta-token');
  });

  it('rejects encryption keys that are not 32 bytes', () => {
    const cipher = makeCipher(Buffer.from('short').toString('base64'));

    expect(() => cipher.encrypt('meta-token')).toThrow(
      'SECRETS_ENCRYPTION_KEY must be base64 encoded 32 bytes',
    );
  });

  it('keeps legacy plaintext secrets readable while new rows are encrypted', () => {
    const cipher = makeCipher();

    expect(cipher.decryptStoredSecret('legacy-meta-token')).toBe(
      'legacy-meta-token',
    );
    expect(cipher.decryptStoredSecret(cipher.encrypt('new-meta-token'))).toBe(
      'new-meta-token',
    );
  });
});
