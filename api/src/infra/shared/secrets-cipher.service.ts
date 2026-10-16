import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AppConfiguration } from '@/infra/config/configuration.types';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class SecretsCipherService {
  constructor(private readonly config: ConfigService<AppConfiguration>) {}

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const key = this.getKey();
    const packed = unpackCiphertext(ciphertext);
    if (packed.length <= IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid encrypted secret payload');
    }

    const iv = packed.subarray(0, IV_LENGTH);
    const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = packed.subarray(IV_LENGTH + TAG_LENGTH);
    // Fixing the tag length stops a shortened tag from being accepted.
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Reads secrets persisted before connection tokens were encrypted. New writes
   * must always use encrypt(); this compatibility path can be removed after a
   * dedicated data migration has re-encrypted legacy rows.
   */
  decryptStoredSecret(value: string): string {
    try {
      return this.decrypt(value);
    } catch {
      return value;
    }
  }

  private getKey(): Buffer {
    const { secretsEncryptionKey } = this.config.getOrThrow('meta', {
      infer: true,
    });
    const key = Buffer.from(secretsEncryptionKey, 'base64');
    if (key.length !== 32) {
      throw new Error('SECRETS_ENCRYPTION_KEY must be base64 encoded 32 bytes');
    }
    return key;
  }
}

function unpackCiphertext(ciphertext: string): Buffer {
  const normalized = ciphertext.trim();
  const compactHex = normalized.replace(/\s+/g, '');
  if (/^\\x[0-9a-fA-F]+$/.test(compactHex)) {
    return Buffer.from(compactHex.slice(2), 'hex');
  }

  return Buffer.from(normalized, 'base64');
}
