import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  EmailProviderCredentials,
  IEmailProvider,
  SendMailOptions,
} from './email-provider.interface';

@Injectable()
export class ResendProvider implements IEmailProvider {
  readonly providerName = 'resend';
  private readonly client: Resend;

  constructor(private readonly config: ConfigService) {
    this.client = new Resend(config.get<string>('RESEND_API_KEY'));
  }

  // `credentials.apiKey` present means a tenant's own decrypted BYOK config
  // — a fresh one-off client is built for that call rather than mutating
  // the shared default one. Falls back to the constructor-injected default
  // client (the pre-BYOK behavior) when absent.
  async sendMail(
    options: SendMailOptions,
    credentials?: EmailProviderCredentials,
  ): Promise<void> {
    const client = credentials?.apiKey
      ? new Resend(credentials.apiKey)
      : this.client;

    const to = Array.isArray(options.to) ? options.to : [options.to];
    let cc: string[] | undefined;
    if (options.cc) {
      cc = Array.isArray(options.cc) ? options.cc : [options.cc];
    }

    const { error } = await client.emails.send({
      from: options.from,
      to,
      cc,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
      })),
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
  }
}
