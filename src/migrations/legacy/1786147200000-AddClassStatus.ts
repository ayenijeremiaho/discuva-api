import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClassStatus1786147200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE church_classes
        ADD COLUMN status character varying NOT NULL DEFAULT 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE church_classes DROP COLUMN status
    `);
  }
}
