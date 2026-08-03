import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ISmsProvider,
  SmsBalance,
  SmsEncoding,
  SmsLogEntry,
  SmsProviderCredentials,
  SmsSendResult,
} from '../interface/sms-provider.interface';

// Termii caps a single bulk-send request at 100 recipients — callers of
// SmsService must batch larger recipient lists themselves.
export const TERMII_MAX_RECIPIENTS_PER_REQUEST = 100;

@Injectable()
export class TermiiSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(TermiiSmsProvider.name);
  private readonly defaultApiKey: string;
  private readonly defaultSenderId: string;
  // Not tenant-specific even under BYOK — every Termii account (platform's
  // own or a tenant's) talks to the same API host, only apiKey/senderId
  // differ per credential set.
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultApiKey = this.configService.get<string>('TERMII_API_KEY');
    this.defaultSenderId = this.configService.get<string>('TERMII_SENDER_ID');
    this.baseUrl = this.configService.get<string>('TERMII_BASE_URL');
  }

  // `credentials` present means a tenant's own decrypted BYOK config
  // (SmsCredentialResolverService) — falls back to this platform's own
  // constructor-injected default (the pre-BYOK behavior) when absent.
  private resolve(credentials?: SmsProviderCredentials) {
    return {
      apiKey: credentials?.apiKey || this.defaultApiKey,
      senderId: credentials?.senderId || this.defaultSenderId,
    };
  }

  async send(
    to: string[],
    message: string,
    encoding: SmsEncoding,
    credentials?: SmsProviderCredentials,
  ): Promise<SmsSendResult> {
    if (to.length > TERMII_MAX_RECIPIENTS_PER_REQUEST) {
      throw new InternalServerErrorException(
        `SMS batch of ${to.length} exceeds the ${TERMII_MAX_RECIPIENTS_PER_REQUEST}-recipient limit per request.`,
      );
    }

    const { apiKey, senderId } = this.resolve(credentials);
    const isBulk = to.length > 1;
    const url = `${this.baseUrl}/api/sms/send${isBulk ? '/bulk' : ''}`;
    const body = {
      api_key: apiKey,
      to: isBulk ? to : to[0],
      from: senderId,
      sms: message,
      type: encoding === 'unicode' ? 'unicode' : 'plain',
      channel: 'dnd',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok || json.code !== 'ok') {
      this.logger.error(`Termii send failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        json.message || 'Failed to send SMS via Termii.',
      );
    }

    return {
      messageId: json.message_id ?? json.message_id_str ?? '',
      status: json.message ?? 'Successfully Sent',
    };
  }

  async getBalance(credentials?: SmsProviderCredentials): Promise<SmsBalance> {
    const { apiKey } = this.resolve(credentials);
    const url = `${this.baseUrl}/api/get-balance?api_key=${apiKey}`;
    const response = await fetch(url);
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      this.logger.error(`Termii balance check failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        'Failed to retrieve SMS balance from Termii.',
      );
    }

    return {
      balance: Number(json.balance ?? 0),
      currency: json.currency ?? 'NGN',
    };
  }

  async getMessageHistory(
    credentials?: SmsProviderCredentials,
  ): Promise<SmsLogEntry[]> {
    const { apiKey } = this.resolve(credentials);
    const url = `${this.baseUrl}/api/sms/inbox?api_key=${apiKey}`;
    const response = await fetch(url);
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      this.logger.error(
        `Termii message history fetch failed: ${JSON.stringify(json)}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve SMS message history from Termii.',
      );
    }

    const records: any[] = Array.isArray(json) ? json : [];
    return records.map((r) => ({
      messageId: r.message_id ?? '',
      recipient: r.receiver ?? '',
      message: r.message ?? '',
      status: r.status ?? '',
      type: r.sms_type ?? '',
      sentAt: r.created_at ?? '',
      sender: r.sender ?? undefined,
    }));
  }
}
