import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProtectedNames1806086400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE protected_names (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying(150) NOT NULL,
        short_forms text[] NOT NULL DEFAULT '{}',
        addresses text[] NOT NULL DEFAULT '{}',
        note character varying(300),
        updated_by_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_protected_names_name" ON protected_names (lower(name))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_protected_names_updated_by" ON protected_names (updated_by_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE protected_names`);
  }
}
