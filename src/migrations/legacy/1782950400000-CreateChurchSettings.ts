import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChurchSettings1782950400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS church_settings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                key VARCHAR NOT NULL,
                module_name VARCHAR NOT NULL,
                value JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT uq_church_settings_key UNIQUE (key)
            )
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS church_settings`);
  }
}
