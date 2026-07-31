import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimestampsToJournalEntryLinesAndLinks1784937600000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE finance_journal_entry_lines
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        `);
    await queryRunner.query(`
            ALTER TABLE finance_journal_entry_links
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE finance_journal_entry_lines
                DROP COLUMN IF EXISTS created_at,
                DROP COLUMN IF EXISTS updated_at
        `);
    await queryRunner.query(`
            ALTER TABLE finance_journal_entry_links
                DROP COLUMN IF EXISTS created_at,
                DROP COLUMN IF EXISTS updated_at
        `);
  }
}
