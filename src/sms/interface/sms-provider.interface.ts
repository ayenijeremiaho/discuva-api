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

// Provider-agnostic contract. Swapping vendors (e.g. away from Termii) means
// writing a new class that implements this and registering it in SmsModule —
// no other call site changes.
export interface ISmsProvider {
  send(
    to: string[],
    message: string,
    encoding: SmsEncoding,
  ): Promise<SmsSendResult>;
  getBalance(): Promise<SmsBalance>;
  getMessageHistory(): Promise<SmsLogEntry[]>;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
