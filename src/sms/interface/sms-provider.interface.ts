export interface SmsSendResult {
  messageId: string;
  status: string;
}

export interface SmsBalance {
  balance: number;
  currency: string;
}

export type SmsEncoding = 'plain' | 'unicode';

export interface SmsLogEntry {
  messageId: string;
  recipient: string;
  message: string;
  status: string;
  type: string;
  sentAt: string;
  sender?: string;
}

// Flat string map, e.g. Termii's { apiKey, senderId } or Twilio's
// { accountSid, authToken, fromNumber } — provider-specific shape,
// deliberately not typed further than this. Always a tenant's own decrypted
// BYOK config — there is no platform-default fallback (pure BYOK, no
// SmsWallet) so every send requires this to be resolved first.
export type SmsProviderCredentials = Record<string, string>;

// Provider-agnostic contract. Adding a vendor means writing a new class that
// implements this and registering it in SmsProviderRegistryService — no
// other call site changes.
export interface ISmsProvider {
  // Recipients per single outbound API call. Termii has a true bulk-send
  // endpoint (100/request); Twilio has no bulk endpoint at all — its
  // provider issues one HTTP call per recipient, so this instead caps
  // concurrency per "batch" to keep that bounded. SmsService.chunk() uses
  // whichever value the resolved provider reports rather than a hardcoded
  // constant, since it now varies by vendor.
  readonly maxRecipientsPerRequest: number;

  send(
    to: string[],
    message: string,
    encoding: SmsEncoding,
    credentials: SmsProviderCredentials,
  ): Promise<SmsSendResult>;
  getBalance(credentials: SmsProviderCredentials): Promise<SmsBalance>;
  getMessageHistory(
    credentials: SmsProviderCredentials,
  ): Promise<SmsLogEntry[]>;
}
