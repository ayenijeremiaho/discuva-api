import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// Symmetric encryption for values that must round-trip back to plaintext
// (tenant BYOK provider credentials — never returned to any client, only
// ever read back internally to make an outbound API call). Different from
// argon2/password hashing elsewhere in this codebase, which is one-way by
// design; these values must be decryptable.
//
// CREDENTIALS_ENCRYPTION_KEY follows the same convention as JWT_SECRET
// (Joi.string().min(32), no fixed-length hex/base64 requirement on the
// operator) — hashed here to a real 32-byte AES-256 key rather than
// requiring the raw env var to be exactly 32 bytes itself.
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('CREDENTIALS_ENCRYPTION_KEY');
    this.key = createHash('sha256').update(secret).digest();
  }

  // Returns a single self-contained string (iv:authTag:ciphertext, each
  // base64) — nothing else needs to be stored alongside it to decrypt later.
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  // Encrypts every string value in a flat credentials object, e.g.
  // { apiKey: 'x', senderId: 'y' } -> { apiKey: 'enc(x)', senderId: 'enc(y)' }.
  // Keeps the stored JSONB shape self-describing (field names intact) while
  // no individual value is ever stored in plaintext.
  encryptFields(fields: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, this.encrypt(v)]),
    );
  }

  decryptFields(fields: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, this.decrypt(v)]),
    );
  }
}
