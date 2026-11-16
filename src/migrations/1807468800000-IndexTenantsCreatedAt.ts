import { MigrationInterface, QueryRunner } from 'typeorm';

// The console's churches list pages newest first.
export class IndexTenantsCreatedAt1807468800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenants_created_at ON tenants (created_at DESC, id DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tenants_created_at`);
  }
}
