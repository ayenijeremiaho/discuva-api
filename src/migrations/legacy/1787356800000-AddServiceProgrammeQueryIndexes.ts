import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceProgrammeQueryIndexes1787356800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backs ServiceSessionService.getActiveSessions() — polled every 20s by
    // the admin app's global "Live" indicator, filtering on status alone.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_sessions_status" ON "service_sessions" ("status")`,
    );

    // Backs ServiceProgrammeService's member double-booking conflict check,
    // run synchronously on every slot assignment (addSlot/updateSlot).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_programme_slots_member" ON "service_programme_slots" ("member_id")`,
    );

    // Backs ServiceProgrammeReminderScheduler's daily query, which filters
    // DRAFT programmes before joining to their slots.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_programmes_status" ON "service_programmes" ("status")`,
    );

    // Partial index matching the reminder scheduler's exact predicate
    // (`reminder_sent_at IS NULL`) — stays small since it only covers
    // not-yet-reminded rows regardless of total table size.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_programme_slots_reminder_pending"
        ON "service_programme_slots" ("reminder_sent_at")
        WHERE "reminder_sent_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_programme_slots_reminder_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_programmes_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_programme_slots_member"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_sessions_status"`,
    );
  }
}
