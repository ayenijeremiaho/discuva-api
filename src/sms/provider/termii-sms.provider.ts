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
  SmsSendResult,
} from '../interface/sms-provider.interface';

// Termii caps a single bulk-send request at 100 recipients — callers of
// SmsService must batch larger recipient lists themselves.
export const TERMII_MAX_RECIPIENTS_PER_REQUEST = 100;

@Injectable()
export class TermiiSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(TermiiSmsProvider.name);
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('TERMII_API_KEY');
    this.senderId = this.configService.get<string>('TERMII_SENDER_ID');
    this.baseUrl = this.configService.get<string>('TERMII_BASE_URL');
  }

  async send(
    to: string[],
    message: string,
    encoding: SmsEncoding,
  ): Promise<SmsSendResult> {
    if (to.length > TERMII_MAX_RECIPIENTS_PER_REQUEST) {
      throw new InternalServerErrorException(
        `SMS batch of ${to.length} exceeds the ${TERMII_MAX_RECIPIENTS_PER_REQUEST}-recipient limit per request.`,
      );
    }

    const isBulk = to.length > 1;
    const url = `${this.baseUrl}/api/sms/send${isBulk ? '/bulk' : ''}`;
    const body = {
      api_key: this.apiKey,
      to: isBulk ? to : to[0],
      from: this.senderId,
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

  async getBalance(): Promise<SmsBalance> {
    const url = `${this.baseUrl}/api/get-balance?api_key=${this.apiKey}`;
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

  async getMessageHistory(): Promise<SmsLogEntry[]> {
    const url = `${this.baseUrl}/api/sms/inbox?api_key=${this.apiKey}`;
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
