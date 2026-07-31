import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceJournalEntries1783987200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_journal_entries (
                id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                date                DATE NOT NULL,
                description         TEXT NOT NULL,
                reference           VARCHAR,
                source              VARCHAR NOT NULL,
                entry_type          VARCHAR NOT NULL,
                status              VARCHAR NOT NULL DEFAULT 'DRAFT',
                idempotency_key     VARCHAR NOT NULL UNIQUE,
                accounting_period_id UUID NOT NULL REFERENCES finance_accounting_periods(id) ON DELETE RESTRICT,
                reversal_of_id      UUID REFERENCES finance_journal_entries(id) ON DELETE SET NULL,
                created_by_id       UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                approved_by_id      UUID REFERENCES admins(id) ON DELETE SET NULL,
                original_currency   VARCHAR,
                exchange_rate       NUMERIC(15,6),
                original_amount     NUMERIC(15,2),
                created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_journal_entry_lines (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                journal_entry_id UUID NOT NULL REFERENCES finance_journal_entries(id) ON DELETE CASCADE,
                account_id       UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
                entry_type       VARCHAR NOT NULL,
                amount           NUMERIC(15,2) NOT NULL
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_journal_entry_links (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                journal_entry_id UUID NOT NULL REFERENCES finance_journal_entries(id) ON DELETE CASCADE,
                link_type        VARCHAR NOT NULL,
                role             VARCHAR NOT NULL,
                member_id        UUID REFERENCES members(id) ON DELETE SET NULL,
                department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
                service_event_id UUID,
                external_payee_id UUID REFERENCES finance_external_payees(id) ON DELETE SET NULL
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_date ON finance_journal_entries(date)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_status ON finance_journal_entries(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_period ON finance_journal_entries(accounting_period_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_created_by ON finance_journal_entries(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_source ON finance_journal_entries(source)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_entry_type ON finance_journal_entries(entry_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_je_date_status ON finance_journal_entries(date, status)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jel_journal_entry ON finance_journal_entry_lines(journal_entry_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jel_account ON finance_journal_entry_lines(account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jel_type_account ON finance_journal_entry_lines(entry_type, account_id)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jelk_journal_entry ON finance_journal_entry_links(journal_entry_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jelk_member ON finance_journal_entry_links(member_id) WHERE member_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jelk_department ON finance_journal_entry_links(department_id) WHERE department_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jelk_service_event ON finance_journal_entry_links(service_event_id) WHERE service_event_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jelk_payee ON finance_journal_entry_links(external_payee_id) WHERE external_payee_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_jelk_link_type ON finance_journal_entry_links(link_type)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS finance_journal_entry_links`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_journal_entry_lines`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_journal_entries`);
  }
}
