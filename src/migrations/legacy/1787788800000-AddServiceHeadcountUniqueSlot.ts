import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceHeadcountUniqueSlot1787788800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Historically nothing stopped more than one headcount row per service
    // slot. Recording is moving to one-per-slot (re-recording edits in
    // place), so keep only the most recently updated row per slot before the
    // constraint goes on, otherwise the ADD CONSTRAINT below fails outright.
    await queryRunner.query(`
      DELETE FROM service_headcounts sh
      USING service_headcounts newer
      WHERE sh.service_slot_id = newer.service_slot_id
        AND sh.updated_at < newer.updated_at
    `);
    await queryRunner.query(`
      DELETE FROM service_headcounts sh
      USING service_headcounts dup
      WHERE sh.service_slot_id = dup.service_slot_id
        AND sh.updated_at = dup.updated_at
        AND sh.id > dup.id
    `);
    await queryRunner.query(`
      ALTER TABLE service_headcounts
      ADD CONSTRAINT uq_service_headcounts_service_slot_id UNIQUE (service_slot_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE service_headcounts
      DROP CONSTRAINT IF EXISTS uq_service_headcounts_service_slot_id
    `);
  }
}
