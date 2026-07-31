import { MigrationInterface, QueryRunner } from 'typeorm';

export class RequestLeaveEnsureDateColumns1782086400000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'request_leave' AND column_name = 'date_from'
                ) THEN
                    ALTER TABLE request_leave
                        ADD COLUMN date_from date NULL,
                        ADD COLUMN date_to   date NULL;
                END IF;
            END
            $$
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'request_leave' AND column_name = 'date_from'
                ) THEN
                    ALTER TABLE request_leave
                        DROP COLUMN date_from,
                        DROP COLUMN date_to;
                END IF;
            END
            $$
        `);
  }
}
