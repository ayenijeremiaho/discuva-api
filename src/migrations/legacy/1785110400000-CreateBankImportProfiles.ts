import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBankImportProfiles1785110400000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE finance_bank_import_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR NOT NULL,
                is_default BOOLEAN NOT NULL DEFAULT FALSE,
                delimiter VARCHAR NOT NULL DEFAULT ',',
                skip_header_rows INT NOT NULL DEFAULT 1,
                date_column_index INT NOT NULL,
                date_format VARCHAR NOT NULL,
                date_column_name VARCHAR,
                narration_column_index INT NOT NULL,
                narration_column_name VARCHAR,
                amount_convention VARCHAR NOT NULL,
                amount_column_index INT,
                amount_column_name VARCHAR,
                type_column_index INT,
                type_column_name VARCHAR,
                debit_indicator VARCHAR,
                credit_indicator VARCHAR,
                debit_column_index INT,
                debit_column_name VARCHAR,
                credit_column_index INT,
                credit_column_name VARCHAR,
                created_by_id UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE UNIQUE INDEX finance_bank_import_profiles_default_idx
                ON finance_bank_import_profiles (is_default)
                WHERE is_default = TRUE
        `);

    const [admin] = await queryRunner.query(`SELECT id FROM admins LIMIT 1`);
    if (admin) {
      await queryRunner.query(
        `
                INSERT INTO finance_bank_import_profiles (
                    name, is_default, delimiter, skip_header_rows,
                    date_column_index, date_format, date_column_name,
                    narration_column_index, narration_column_name,
                    amount_convention, amount_column_index, amount_column_name,
                    type_column_index, type_column_name,
                    debit_indicator, credit_indicator,
                    created_by_id
                ) VALUES (
                    'Default (Date, Narration, Amount, Type)',
                    TRUE, ',', 1,
                    0, 'YYYY-MM-DD', 'Date',
                    1, 'Narration',
                    'AMOUNT_WITH_TYPE', 2, 'Amount',
                    3, 'Type',
                    'DEBIT', 'CREDIT',
                    $1
                )
            `,
        [admin.id],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS finance_bank_import_profiles_default_idx`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS finance_bank_import_profiles`,
    );
  }
}
