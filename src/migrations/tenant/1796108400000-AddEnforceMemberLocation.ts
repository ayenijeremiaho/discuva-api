import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnforceMemberLocation1796108400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_config
        ADD enforce_member_location BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE service_slots
        ADD enforce_member_location_override BOOLEAN
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE service_slots
        DROP COLUMN enforce_member_location_override
    `);
    await queryRunner.query(`
      ALTER TABLE event_config
        DROP COLUMN enforce_member_location
    `);
  }
}
