import { MigrationInterface, QueryRunner } from 'typeorm';

// Control-plane change — communication_providers lives in `public`. Adding
// a provider with a concrete IEmailProvider implementation is a row insert,
// not a schema change (docs §4.12) — smtp/sendgrid/mailgun join the
// existing gmail/resend catalog entries seeded in
// AddPlatformControlPlaneTables.
export class AddEmailProviderCatalogEntries1791331200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO communication_providers (id, channel, name) VALUES
        ('smtp', 'email', 'Custom SMTP'),
        ('sendgrid', 'email', 'SendGrid'),
        ('mailgun', 'email', 'Mailgun')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM communication_providers WHERE id IN ('smtp', 'sendgrid', 'mailgun')
    `);
  }
}
