export interface SendMailOptions {
  from: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: string; encoding: 'base64' }[];
}

// Flat string map — provider-specific shape, deliberately not typed further
// than this (same convention as SmsProviderCredentials). Gmail: { user,
// password }. Resend: { apiKey }. Comes from a tenant's own decrypted BYOK
// config (EmailCredentialResolverService) or is omitted entirely, meaning
// "use this provider's own platform-default credentials".
export type EmailProviderCredentials = Record<string, string>;

export interface IEmailProvider {
  readonly providerName: string;
  sendMail(
    options: SendMailOptions,
    credentials?: EmailProviderCredentials,
  ): Promise<void>;
}
