import { MigrationInterface, QueryRunner } from 'typeorm';

export class FollowUpModule1782000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE events
                ADD COLUMN IF NOT EXISTS online_attendance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS online_notification_sent_at TIMESTAMPTZ NULL
        `);

    await queryRunner.query(`
            CREATE TABLE first_timers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                firstname VARCHAR NOT NULL,
                lastname VARCHAR NOT NULL,
                phone VARCHAR NOT NULL,
                email VARCHAR NULL,
                source CHARACTER VARYING NOT NULL DEFAULT 'WALK_IN',
                wants_to_join_church BOOLEAN NOT NULL DEFAULT FALSE,
                enjoyed_about_church TEXT NULL,
                wants_to_join_workforce BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT NULL,
                visited_event_id UUID NULL REFERENCES events(id) ON DELETE SET NULL,
                created_by_member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL,
                created_by_admin_id UUID NULL REFERENCES admins(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE follow_up_tasks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                type CHARACTER VARYING NOT NULL DEFAULT 'FIRST_TIMER',
                status CHARACTER VARYING NOT NULL DEFAULT 'PENDING',
                first_timer_id UUID NULL REFERENCES first_timers(id) ON DELETE CASCADE,
                member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL,
                event_id UUID NULL REFERENCES events(id) ON DELETE SET NULL,
                assigned_to_id UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE RESTRICT,
                outcome CHARACTER VARYING NULL,
                outcome_notes TEXT NULL,
                due_date DATE NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE follow_up_notes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                task_id UUID NOT NULL REFERENCES follow_up_tasks(id) ON DELETE CASCADE,
                added_by_id UUID NULL REFERENCES worker_profiles(id) ON DELETE SET NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX idx_follow_up_tasks_assigned_to ON follow_up_tasks(assigned_to_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_tasks_status ON follow_up_tasks(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_tasks_type ON follow_up_tasks(type)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_notes_task ON follow_up_notes(task_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_first_timers_visited_event ON first_timers(visited_event_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_first_timers_visited_event`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_follow_up_notes_task`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_follow_up_tasks_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_follow_up_tasks_status`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_follow_up_tasks_assigned_to`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS follow_up_notes`);
    await queryRunner.query(`DROP TABLE IF EXISTS follow_up_tasks`);
    await queryRunner.query(`DROP TABLE IF EXISTS first_timers`);
    await queryRunner.query(`
            ALTER TABLE events
                DROP COLUMN IF EXISTS online_attendance_enabled,
                DROP COLUMN IF EXISTS online_notification_sent_at
        `);
  }
}
