import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

const mockConfigService = {
  get: jest
    .fn()
    .mockReturnValue('a-test-secret-that-is-at-least-32-chars-long'),
};

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    service = new EncryptionService(
      mockConfigService as unknown as ConfigService,
    );
  });

  describe('encrypt/decrypt', () => {
    it('round-trips a plaintext value', () => {
      const plaintext = 'sk_live_super_secret_api_key_123';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('never stores the plaintext value inside the ciphertext', () => {
      const plaintext = 'sk_live_super_secret_api_key_123';
      expect(service.encrypt(plaintext)).not.toContain(plaintext);
    });

    it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
      const plaintext = 'same-value';
      expect(service.encrypt(plaintext)).not.toBe(service.encrypt(plaintext));
    });

    it('throws when decrypting a tampered payload (auth tag mismatch)', () => {
      const encrypted = service.encrypt('sensitive-value');
      const [iv, authTag, ciphertext] = encrypted.split(':');
      const tampered = [iv, authTag, ciphertext.slice(0, -4) + 'AAAA'].join(
        ':',
      );
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('decrypting with a different key fails', () => {
      const encrypted = service.encrypt('sensitive-value');
      const otherService = new EncryptionService({
        get: jest
          .fn()
          .mockReturnValue('a-completely-different-secret-key-value'),
      } as unknown as ConfigService);
      expect(() => otherService.decrypt(encrypted)).toThrow();
    });
  });

  describe('encryptFields/decryptFields', () => {
    it('round-trips every value in a flat object while keeping field names intact', () => {
      const fields = { apiKey: 'key123', senderId: 'MYCHURCH' };
      const encrypted = service.encryptFields(fields);

      expect(Object.keys(encrypted)).toEqual(['apiKey', 'senderId']);
      expect(encrypted.apiKey).not.toBe('key123');
      expect(encrypted.senderId).not.toBe('MYCHURCH');

      expect(service.decryptFields(encrypted)).toEqual(fields);
    });
  });
});
