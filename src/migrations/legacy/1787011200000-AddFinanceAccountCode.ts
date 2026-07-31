import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinanceAccountCode1787011200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_accounts" ADD COLUMN "code" character varying
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_finance_accounts_code"
        ON "finance_accounts" ("code")
        WHERE "code" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_finance_accounts_code"`);
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" DROP COLUMN "code"`,
    );
  }
}
