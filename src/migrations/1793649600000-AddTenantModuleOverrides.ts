import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantModuleOverrides1793649600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants ADD module_overrides jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants DROP COLUMN module_overrides
    `);
  }
}
