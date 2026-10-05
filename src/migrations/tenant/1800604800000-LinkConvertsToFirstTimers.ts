import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkConvertsToFirstTimers1800604800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE converts
        ADD COLUMN IF NOT EXISTS first_timer_id UUID,
        ADD COLUMN IF NOT EXISTS first_timer_linked_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE converts
        ADD CONSTRAINT "FK_converts_first_timer_id" FOREIGN KEY (first_timer_id) REFERENCES first_timers(id) ON DELETE SET NULL
    `);
    // One convert per first-timer.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_converts_first_timer_id" ON converts (first_timer_id) WHERE first_timer_id IS NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE first_timers
        ADD COLUMN IF NOT EXISTS dismissed_convert_ids UUID[] NOT NULL DEFAULT '{}'
    `);

    // Evangelism lists sort by created_at and filter/report by date ranges.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_created_at" ON converts (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_linked_at" ON converts (linked_at) WHERE linked_at IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_first_timer_linked_at" ON converts (first_timer_linked_at) WHERE first_timer_linked_at IS NOT NULL`,
    );
    // "Needs follow-up": converts still with Evangelism, by last contact.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_open_last_contacted_at" ON converts (last_contacted_at) WHERE member_id IS NULL AND first_timer_id IS NULL`,
    );
    // Name-only match suggestions for converts recorded without a phone.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_converts_lower_name" ON converts (LOWER(name))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_convert_follow_up_logs_contacted_at" ON convert_follow_up_logs (contacted_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of [
      'IDX_convert_follow_up_logs_contacted_at',
      'IDX_converts_lower_name',
      'IDX_converts_open_last_contacted_at',
      'IDX_converts_first_timer_linked_at',
      'IDX_converts_linked_at',
      'IDX_converts_created_at',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${index}"`);
    }
    await queryRunner.query(
      `ALTER TABLE first_timers DROP COLUMN IF EXISTS dismissed_convert_ids`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_converts_first_timer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE converts DROP CONSTRAINT IF EXISTS "FK_converts_first_timer_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE converts
        DROP COLUMN IF EXISTS first_timer_linked_at,
        DROP COLUMN IF EXISTS first_timer_id
    `);
  }
}
