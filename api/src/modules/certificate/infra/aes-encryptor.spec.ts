import { CertificateEncryptor } from './aes-encryptor';

describe('CertificateEncryptor', () => {
  let encryptor: CertificateEncryptor;
  const originalEnv = process.env.NFSE_MASTER_KEY;

  beforeEach(() => {
    // Set a test master key (64 hex chars = 256 bits)
    process.env.NFSE_MASTER_KEY = 'a'.repeat(64);
    encryptor = new CertificateEncryptor();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NFSE_MASTER_KEY;
    } else {
      process.env.NFSE_MASTER_KEY = originalEnv;
    }
  });

  describe('constructor / deriveKek', () => {
    it('throws when NFSE_MASTER_KEY is not set', async () => {
      delete process.env.NFSE_MASTER_KEY;
      const encryptorWithoutKey = new CertificateEncryptor();

      // Error is thrown when encrypt() is called and deriveKek() is invoked
      await expect(
        encryptorWithoutKey.encrypt(Buffer.from('test')),
      ).rejects.toThrow('NFSE_MASTER_KEY environment variable is not set');
    });

    it('derives KEK successfully when NFSE_MASTER_KEY is set', () => {
      // No error means deriveKek worked
      expect(() => encryptor.encrypt(Buffer.from('test'))).not.toThrow();
    });
  });

  describe('encrypt', () => {
    it('encrypts and decrypts a buffer back to original', async () => {
      const originalData = Buffer.from('Hello, this is test P12 data!');
      const { encryptedBlob, encryptedDek, dekIv } =
        await encryptor.encrypt(originalData);

      expect(encryptedBlob).toBeInstanceOf(Buffer);
      expect(encryptedDek).toBeInstanceOf(Buffer);
      expect(dekIv).toBeInstanceOf(Buffer);

      // Decrypt and verify
      const decrypted = await encryptor.decrypt(
        encryptedBlob,
        encryptedDek,
        dekIv,
      );

      expect(decrypted.toString()).toBe(originalData.toString());
    });

    it('produces different ciphertext for same input (random IV/DEK)', async () => {
      const originalData = Buffer.from('Same input data');
      const result1 = await encryptor.encrypt(originalData);
      const result2 = await encryptor.encrypt(originalData);

      // Ciphertexts should be different due to random IVs and DEK
      expect(result1.encryptedBlob.equals(result2.encryptedBlob)).toBe(false);
      expect(result1.dekIv.equals(result2.dekIv)).toBe(false);
      expect(result1.encryptedDek.equals(result2.encryptedDek)).toBe(false);
    });

    it('produces 32-byte encrypted DEK', async () => {
      const { encryptedDek } = await encryptor.encrypt(
        Buffer.from('test data'),
      );

      // encryptedDek = ciphertext (32 bytes) + authTag (16 bytes) = 48 bytes
      expect(encryptedDek.length).toBe(48);
    });

    it('produces 12-byte dekIv', async () => {
      const { dekIv } = await encryptor.encrypt(Buffer.from('test data'));

      expect(dekIv.length).toBe(12);
    });

    it('encrypts large P12-like buffers correctly', async () => {
      // Simulate a P12 file (variable size)
      const largeData = Buffer.alloc(4096);
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }

      const { encryptedBlob, encryptedDek, dekIv } =
        await encryptor.encrypt(largeData);

      expect(encryptedBlob.length).toBeGreaterThan(largeData.length);

      const decrypted = await encryptor.decrypt(
        encryptedBlob,
        encryptedDek,
        dekIv,
      );

      expect(decrypted.equals(largeData)).toBe(true);
    });

    it('encrypts empty buffer', async () => {
      const emptyData = Buffer.alloc(0);
      const { encryptedBlob, encryptedDek, dekIv } =
        await encryptor.encrypt(emptyData);

      const decrypted = await encryptor.decrypt(
        encryptedBlob,
        encryptedDek,
        dekIv,
      );

      expect(decrypted.length).toBe(0);
    });

    it('encrypts binary data with null bytes', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe]);
      const { encryptedBlob, encryptedDek, dekIv } =
        await encryptor.encrypt(binaryData);

      const decrypted = await encryptor.decrypt(
        encryptedBlob,
        encryptedDek,
        dekIv,
      );

      expect(decrypted.equals(binaryData)).toBe(true);
    });
  });

  describe('decrypt', () => {
    it('throws when decrypting with wrong IV', async () => {
      const originalData = Buffer.from('Secret P12 data');
      const { encryptedBlob, encryptedDek } =
        await encryptor.encrypt(originalData);
      const wrongIv = Buffer.from('wrongwrong123'); // 12 bytes

      await expect(
        encryptor.decrypt(encryptedBlob, encryptedDek, wrongIv),
      ).rejects.toThrow();
    });

    it('throws when using encrypted DEK from different encryption', async () => {
      const originalData = Buffer.from('Secret P12 data');
      const { encryptedBlob, dekIv } = await encryptor.encrypt(originalData);
      const { encryptedDek: wrongDek } = await encryptor.encrypt(
        Buffer.from('different'),
      );

      await expect(
        encryptor.decrypt(encryptedBlob, wrongDek, dekIv),
      ).rejects.toThrow();
    });

    it('throws when tampering with ciphertext', async () => {
      const originalData = Buffer.from('Secret P12 data');
      const { encryptedBlob, encryptedDek, dekIv } =
        await encryptor.encrypt(originalData);

      // Tamper with the encrypted blob
      encryptedBlob[0] ^= 0xff;

      await expect(
        encryptor.decrypt(encryptedBlob, encryptedDek, dekIv),
      ).rejects.toThrow();
    });

    it('uses different IVs for blob and DEK', async () => {
      const { encryptedBlob, dekIv } = await encryptor.encrypt(
        Buffer.from('test'),
      );

      // The blob IV is appended at the end of encryptedBlob
      const blobIv = encryptedBlob.slice(-12);

      expect(blobIv.equals(dekIv)).toBe(false);
    });
  });

  describe('envelope encryption consistency', () => {
    it('can decrypt data encrypted with same key multiple times in sequence', async () => {
      const data = Buffer.from('Sequential encryption test');

      const result1 = await encryptor.encrypt(data);
      const result2 = await encryptor.encrypt(data);

      // Both should decrypt correctly
      const decrypted1 = await encryptor.decrypt(
        result1.encryptedBlob,
        result1.encryptedDek,
        result1.dekIv,
      );
      const decrypted2 = await encryptor.decrypt(
        result2.encryptedBlob,
        result2.encryptedDek,
        result2.dekIv,
      );

      expect(decrypted1.equals(data)).toBe(true);
      expect(decrypted2.equals(data)).toBe(true);
    });
  });
});
