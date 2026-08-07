import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  ISmsProvider,
  SmsBalance,
  SmsEncoding,
  SmsLogEntry,
  SmsProviderCredentials,
  SmsSendResult,
} from '../interface/sms-provider.interface';

// Twilio's Messages API has no bulk-send endpoint (unlike Termii) — one
// recipient per HTTP call. This caps how many of those SmsService fires
// concurrently per "batch", not a vendor-imposed request limit.
export const TWILIO_MAX_RECIPIENTS_PER_REQUEST = 20;

function authHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

@Injectable()
export class TwilioSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  readonly maxRecipientsPerRequest = TWILIO_MAX_RECIPIENTS_PER_REQUEST;
  private readonly baseUrl = 'https://api.twilio.com/2010-04-01';

  // Twilio credentials — no encoding/segment param on the wire, Twilio
  // detects GSM-7 vs UCS-2 itself server-side; `encoding` is accepted only
  // to match ISmsProvider's shape (used by other vendors, e.g. Termii).
  async send(
    to: string[],
    message: string,
    _encoding: SmsEncoding,
    credentials: SmsProviderCredentials,
  ): Promise<SmsSendResult> {
    if (to.length > TWILIO_MAX_RECIPIENTS_PER_REQUEST) {
      throw new InternalServerErrorException(
        `SMS batch of ${to.length} exceeds the ${TWILIO_MAX_RECIPIENTS_PER_REQUEST}-recipient limit per request.`,
      );
    }

    const { accountSid, authToken, fromNumber } = credentials;
    const url = `${this.baseUrl}/Accounts/${accountSid}/Messages.json`;
    const headers = {
      Authorization: authHeader(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    const responses = await Promise.all(
      to.map(async (recipient) => {
        const body = new URLSearchParams({
          To: recipient,
          From: fromNumber,
          Body: message,
        });
        const response = await fetch(url, { method: 'POST', headers, body });
        const json: any = await response.json().catch(() => ({}));
        return { response, json };
      }),
    );

    const failed = responses.find(({ response }) => !response.ok);
    if (failed) {
      this.logger.error(`Twilio send failed: ${JSON.stringify(failed.json)}`);
      throw new InternalServerErrorException(
        failed.json.message || 'Failed to send SMS via Twilio.',
      );
    }

    return {
      messageId: responses.map(({ json }) => json.sid).join(','),
      status: responses[responses.length - 1]?.json.status ?? 'queued',
    };
  }

  async getBalance(credentials: SmsProviderCredentials): Promise<SmsBalance> {
    const { accountSid, authToken } = credentials;
    const url = `${this.baseUrl}/Accounts/${accountSid}/Balance.json`;
    const response = await fetch(url, {
      headers: { Authorization: authHeader(accountSid, authToken) },
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      this.logger.error(`Twilio balance check failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        'Failed to retrieve SMS balance from Twilio.',
      );
    }

    return {
      balance: Number(json.balance ?? 0),
      currency: json.currency ?? 'USD',
    };
  }

  async getMessageHistory(
    credentials: SmsProviderCredentials,
  ): Promise<SmsLogEntry[]> {
    const { accountSid, authToken } = credentials;
    const url = `${this.baseUrl}/Accounts/${accountSid}/Messages.json?PageSize=50`;
    const response = await fetch(url, {
      headers: { Authorization: authHeader(accountSid, authToken) },
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      this.logger.error(
        `Twilio message history fetch failed: ${JSON.stringify(json)}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve SMS message history from Twilio.',
      );
    }

    const records: any[] = Array.isArray(json.messages) ? json.messages : [];
    return records.map((r) => ({
      messageId: r.sid ?? '',
      recipient: r.to ?? '',
      message: r.body ?? '',
      status: r.status ?? '',
      type: r.direction ?? '',
      sentAt: r.date_sent ?? '',
      sender: r.from ?? undefined,
    }));
  }
}
