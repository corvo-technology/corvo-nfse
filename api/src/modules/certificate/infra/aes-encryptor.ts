import { ConfigService } from '@nestjs/config';
import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const DEK_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (GCM recommended)
const TAG_LENGTH = 16; // 128 bits
const KEK_SALT = 'nfse-certificate-v1'; // Fixed salt for KEK derivation

@Injectable()
export class CertificateEncryptor {
  constructor(@Optional() private readonly config?: ConfigService) {}
  private deriveKek(): Buffer {
    const masterKey =
      this.config?.get<string>('NFSE_MASTER_KEY') ??
      process.env.NFSE_MASTER_KEY;
    if (!masterKey) {
      throw new Error('NFSE_MASTER_KEY environment variable is not set');
    }
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        masterKey,
        KEK_SALT,
        'nfse-certificate-kek',
        DEK_LENGTH,
      ),
    );
  }

  /**
   * Encrypts a P12 blob using envelope encryption:
   * 1. Generate random DEK (32 bytes)
   * 2. Encrypt blob with DEK (AES-256-GCM) using random blobIv
   * 3. Encrypt DEK with KEK (AES-256-GCM) using random dekIv
   *
   * Returns: encryptedBlob (ciphertext + authTag + blobIv appended), encryptedDek (ciphertext + authTag), dekIv
   */
  // Preserve the asynchronous port while Node performs encryption locally.
  // eslint-disable-next-line @typescript-eslint/require-await
  async encrypt(blob: Buffer): Promise<{
    encryptedBlob: Buffer;
    encryptedDek: Buffer;
    dekIv: Buffer;
  }> {
    // Step 1: Generate random DEK and IVs
    const dek = crypto.randomBytes(DEK_LENGTH);
    const dekIv = crypto.randomBytes(IV_LENGTH);

    // Step 2: Encrypt blob with DEK (AES-256-GCM)
    const blobIv = crypto.randomBytes(IV_LENGTH);
    const cipherBlob = crypto.createCipheriv(ALGORITHM, dek, blobIv, {
      authTagLength: TAG_LENGTH,
    });
    const encryptedBlob = Buffer.concat([
      cipherBlob.update(blob),
      cipherBlob.final(),
      cipherBlob.getAuthTag(),
      blobIv, // Append blob IV so decrypt can retrieve it
    ]);

    // Step 3: Encrypt DEK with KEK (AES-256-GCM)
    const kek = this.deriveKek();
    const cipherDek = crypto.createCipheriv(ALGORITHM, kek, dekIv, {
      authTagLength: TAG_LENGTH,
    });
    const encryptedDek = Buffer.concat([
      cipherDek.update(dek),
      cipherDek.final(),
      cipherDek.getAuthTag(),
    ]);

    return {
      encryptedBlob,
      encryptedDek,
      dekIv,
    };
  }

  /**
   * Decrypts an envelope-encrypted blob.
   * Extracts blobIv from the end of encryptedBlob, then decrypts in reverse order.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async decrypt(
    encryptedBlob: Buffer,
    encryptedDek: Buffer,
    dekIv: Buffer,
  ): Promise<Buffer> {
    // Extract blobIv (last 12 bytes) and ciphertext+tag (everything before)
    const blobIv = encryptedBlob.slice(-IV_LENGTH);
    const blobCiphertext = encryptedBlob.slice(0, -IV_LENGTH - TAG_LENGTH);
    const blobTag = encryptedBlob.slice(-IV_LENGTH - TAG_LENGTH, -IV_LENGTH);

    // Step 1: Decrypt DEK with KEK
    const kek = this.deriveKek();
    const dekTag = encryptedDek.slice(-TAG_LENGTH);
    const dekCiphertext = encryptedDek.slice(0, -TAG_LENGTH);
    const decipherDek = crypto.createDecipheriv(ALGORITHM, kek, dekIv, {
      authTagLength: TAG_LENGTH,
    });
    decipherDek.setAuthTag(dekTag);
    const dek = Buffer.concat([
      decipherDek.update(dekCiphertext),
      decipherDek.final(),
    ]);

    // Step 2: Decrypt blob with DEK
    const decipherBlob = crypto.createDecipheriv(ALGORITHM, dek, blobIv, {
      authTagLength: TAG_LENGTH,
    });
    decipherBlob.setAuthTag(blobTag);
    return Buffer.concat([
      decipherBlob.update(blobCiphertext),
      decipherBlob.final(),
    ]);
  }
}
