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

// Flat string map, e.g. Termii's { apiKey, senderId } — provider-specific
// shape, deliberately not typed further than this. Comes from either a
// tenant's own decrypted BYOK config (SmsCredentialResolverService) or is
// omitted entirely, meaning "use this provider's own platform-default
// credentials" (§4.12).
export type SmsProviderCredentials = Record<string, string>;

// Provider-agnostic contract. Swapping vendors (e.g. away from Termii) means
// writing a new class that implements this and registering it in SmsModule —
// no other call site changes.
export interface ISmsProvider {
  send(
    to: string[],
    message: string,
    encoding: SmsEncoding,
    credentials?: SmsProviderCredentials,
  ): Promise<SmsSendResult>;
  getBalance(credentials?: SmsProviderCredentials): Promise<SmsBalance>;
  getMessageHistory(
    credentials?: SmsProviderCredentials,
  ): Promise<SmsLogEntry[]>;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
