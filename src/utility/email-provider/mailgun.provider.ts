import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProviderCredentials,
  IEmailProvider,
  SendMailOptions,
} from './email-provider.interface';

@Injectable()
export class MailgunProvider implements IEmailProvider {
  readonly providerName = 'mailgun';
  private readonly defaultApiKey: string;
  private readonly defaultDomain: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.defaultApiKey = config.get<string>('MAILGUN_API_KEY');
    this.defaultDomain = config.get<string>('MAILGUN_DOMAIN');
    this.baseUrl =
      config.get<string>('MAILGUN_BASE_URL') || 'https://api.mailgun.net/v3';
  }

  async sendMail(
    options: SendMailOptions,
    credentials?: EmailProviderCredentials,
  ): Promise<void> {
    const apiKey = credentials?.apiKey || this.defaultApiKey;
    const domain = credentials?.domain || this.defaultDomain;
    if (!apiKey || !domain) {
      throw new InternalServerErrorException(
        'No Mailgun API key/domain configured for this tenant or the platform.',
      );
    }

    const form = new FormData();
    form.append('from', options.from);
    for (const to of Array.isArray(options.to) ? options.to : [options.to]) {
      form.append('to', to);
    }
    if (options.cc) {
      for (const cc of Array.isArray(options.cc) ? options.cc : [options.cc]) {
        form.append('cc', cc);
      }
    }
    form.append('subject', options.subject);
    form.append('html', options.html);
    for (const attachment of options.attachments || []) {
      form.append(
        'attachment',
        new Blob([Buffer.from(attachment.content, 'base64')]),
        attachment.filename,
      );
    }

    const response = await fetch(`${this.baseUrl}/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
      },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Mailgun send failed (${response.status}): ${body}`,
      );
    }
  }
}
