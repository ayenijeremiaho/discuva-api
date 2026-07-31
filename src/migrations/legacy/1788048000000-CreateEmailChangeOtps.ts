import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmailChangeOtps1788048000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS email_change_otps (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                member_id  UUID NOT NULL,
                otp_hash   VARCHAR NOT NULL,
                new_email  VARCHAR NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at    TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_email_change_otps_member_id ON email_change_otps(member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS email_change_otps`);
  }
}
