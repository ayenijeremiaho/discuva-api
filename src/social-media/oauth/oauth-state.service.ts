import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EncryptionService } from '../../utility/service/encryption.service';

export interface OAuthState {
  accountId: string;
  tenantId: string;
  nonce: string;
  issuedAt: number;
}

// The `state` param is OAuth's designated CSRF-protection slot — reused
// here to also carry which tenant/account this connect attempt belongs to,
// since the callback route has no tenant subdomain in its Host header to
// resolve that from otherwise (same reasoning as webhooks/giving/:tenantId,
// just encoded in state instead of the URL path — Meta/Google/X's redirect
// echoes state back verbatim, but not arbitrary extra path segments).
// AES-256-GCM's auth tag already makes this tamper-evident (decrypt throws
// if the ciphertext was altered), so this doubles as the CSRF/forgery
// protection without a separate HMAC or JWT.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

@Injectable()
export class OAuthStateService {
  constructor(private readonly encryptionService: EncryptionService) {}

  encode(accountId: string, tenantId: string): string {
    const state: OAuthState = {
      accountId,
      tenantId,
      nonce: randomUUID(),
      issuedAt: Date.now(),
    };
    return this.encryptionService.encrypt(JSON.stringify(state));
  }

  // Throws (via EncryptionService.decrypt or JSON.parse) on any tampering
  // or malformed input — callers should let that propagate as a rejected
  // callback, never swallow it into a fallback state.
  decode(state: string): OAuthState {
    const parsed = JSON.parse(
      this.encryptionService.decrypt(state),
    ) as OAuthState;
    if (Date.now() - parsed.issuedAt > STATE_MAX_AGE_MS) {
      throw new Error('OAuth state has expired — restart the connection.');
    }
    return parsed;
  }
}
