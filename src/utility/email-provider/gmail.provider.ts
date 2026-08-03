import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  EmailProviderCredentials,
  IEmailProvider,
  SendMailOptions,
} from './email-provider.interface';

@Injectable()
export class GmailProvider implements IEmailProvider {
  readonly providerName = 'gmail';
  private readonly transporter: nodemailer.Transporter;
  private readonly host: string;
  private readonly port: number;
  private readonly secure: boolean;
  private readonly service: string;

  constructor(private readonly config: ConfigService) {
    this.host = config.get<string>('EMAIL_HOST');
    this.port = config.get<number>('EMAIL_PORT');
    this.secure = config.get<boolean>('EMAIL_SECURE');
    this.service = config.get<string>('EMAIL_SERVICE');
    this.transporter = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: this.secure,
      service: this.service,
      auth: {
        user: config.get<string>('EMAIL_USER'),
        pass: config.get<string>('EMAIL_PASSWORD'),
      },
    });
  }

  // `credentials` present means a tenant's own decrypted BYOK config —
  // `user`/`password` are always required, `host`/`port`/`secure` are
  // optional overrides. A tenant who only sets user/password gets this
  // platform's own host/port/secure/service (e.g. a different Gmail
  // mailbox on the same platform SMTP settings); a tenant who also sets
  // `host` gets routed to an entirely different mail server (Outlook/
  // Office365, Zoho, their own company mail server, or Gmail with manually
  // supplied SMTP settings) — this is what actually lets a tenant "choose
  // whichever domain" rather than being locked to this platform's own
  // provider. `service` is deliberately never taken from credentials: it's
  // a nodemailer preset name (e.g. 'gmail'), not something a tenant using a
  // custom host would want silently overriding their explicit host/port.
  async sendMail(
    options: SendMailOptions,
    credentials?: EmailProviderCredentials,
  ): Promise<void> {
    const transporter = credentials
      ? nodemailer.createTransport({
          host: credentials.host || this.host,
          port: credentials.port ? Number(credentials.port) : this.port,
          secure:
            credentials.secure !== undefined
              ? credentials.secure === 'true'
              : this.secure,
          service: credentials.host ? undefined : this.service,
          auth: { user: credentials.user, pass: credentials.password },
        })
      : this.transporter;

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
