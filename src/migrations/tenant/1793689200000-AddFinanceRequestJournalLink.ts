import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinanceRequestJournalLink1793689200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_journal_entry_links ADD COLUMN finance_request_id UUID NULL
    `);
    await queryRunner.query(`
      ALTER TABLE finance_requests ADD COLUMN journal_entry_id UUID NULL
    `);
    await queryRunner.query(`
      ALTER TABLE finance_requests
      ADD CONSTRAINT "FK_finance_requests_journal_entry_id"
      FOREIGN KEY (journal_entry_id) REFERENCES finance_journal_entries(id) ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_requests DROP CONSTRAINT "FK_finance_requests_journal_entry_id"
    `);
    await queryRunner.query(`
      ALTER TABLE finance_requests DROP COLUMN journal_entry_id
    `);
    await queryRunner.query(`
      ALTER TABLE finance_journal_entry_links DROP COLUMN finance_request_id
    `);
  }
}
