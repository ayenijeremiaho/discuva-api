import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  EmailProviderCredentials,
  IEmailProvider,
  SendMailOptions,
} from './email-provider.interface';

// Deliberately BYOK-only — unlike GmailProvider/ResendProvider/etc, there is
// no sensible "platform default" for an arbitrary SMTP server: choosing
// this provider IS the tenant bringing their own server. A tenant who just
// wants a different mailbox on this platform's own SMTP settings should use
// the `gmail` provider instead (its credentials also accept an optional
// `host` override — see its own comment) — this one is for a tenant who
// wants full control: Outlook/Office365, Zoho Mail, their own company mail
// server, or anything else SMTP-compatible, entirely on their own account.
@Injectable()
export class SmtpProvider implements IEmailProvider {
  readonly providerName = 'smtp';

  async sendMail(
    options: SendMailOptions,
    credentials?: EmailProviderCredentials,
  ): Promise<void> {
    if (!credentials?.host || !credentials?.user || !credentials?.password) {
      throw new InternalServerErrorException(
        'The smtp provider requires host, user, and password credentials — there is no platform default to fall back to.',
      );
    }

    const transporter = nodemailer.createTransport({
      host: credentials.host,
      port: credentials.port ? Number(credentials.port) : 587,
      secure: credentials.secure === 'true',
      auth: { user: credentials.user, pass: credentials.password },
    });

    await transporter.sendMail({
      from: options.from,
      to: options.to,
      cc: options.cc,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    });
  }
}
