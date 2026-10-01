import { MigrationInterface, QueryRunner } from 'typeorm';

// Sessions now always end (2 hours by default); give any created without an end the same default.
export class BackfillClassSessionEndTimes1800082800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE class_sessions SET ends_at = starts_at + interval '2 hours' WHERE ends_at IS NULL`,
    );
  }

  // Which rows were backfilled isn't recorded, so there's nothing safe to undo.
  async down(): Promise<void> {}
}
