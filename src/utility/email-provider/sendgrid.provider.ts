import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProviderCredentials,
  IEmailProvider,
  SendMailOptions,
} from './email-provider.interface';

function toAddressList(
  value: string | string[] | undefined,
): { email: string }[] | undefined {
  if (!value) return undefined;
  const addresses = Array.isArray(value) ? value : [value];
  return addresses.map((email) => ({ email }));
}

@Injectable()
export class SendGridProvider implements IEmailProvider {
  readonly providerName = 'sendgrid';
  private readonly defaultApiKey: string;

  constructor(private readonly config: ConfigService) {
    this.defaultApiKey = config.get<string>('SENDGRID_API_KEY');
  }

  async sendMail(
    options: SendMailOptions,
    credentials?: EmailProviderCredentials,
  ): Promise<void> {
    const apiKey = credentials?.apiKey || this.defaultApiKey;
    if (!apiKey) {
      throw new InternalServerErrorException(
        'No SendGrid API key configured for this tenant or the platform.',
      );
    }

    const to = toAddressList(options.to);
    const cc = toAddressList(options.cc);

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to, cc }],
        from: { email: options.from },
        subject: options.subject,
        content: [{ type: 'text/html', value: options.html }],
        attachments: options.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
        })),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `SendGrid send failed (${response.status}): ${body}`,
      );
    }
  }
}
