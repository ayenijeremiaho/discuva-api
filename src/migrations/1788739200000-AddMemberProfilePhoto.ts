import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemberProfilePhoto1788739200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        ADD COLUMN photo_url character varying,
        ADD COLUMN photo_public_id character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE members
        DROP COLUMN photo_url,
        DROP COLUMN photo_public_id
    `);
  }
}
