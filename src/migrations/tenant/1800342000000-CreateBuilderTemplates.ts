import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBuilderTemplates1800342000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE builder_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind VARCHAR(32) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(240),
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IDX_builder_templates_kind ON builder_templates (kind)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE builder_templates`);
  }
}
