import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountTypeChanges1806000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE account_type_changes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_type character varying NOT NULL,
        actor_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
        changes jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_account_type_changes_type_created" ON account_type_changes (account_type, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_account_type_changes_actor" ON account_type_changes (actor_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE account_type_changes`);
  }
}
