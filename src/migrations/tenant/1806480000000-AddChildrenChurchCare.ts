import { MigrationInterface, QueryRunner } from 'typeorm';

// Parent-kept details, today's away message, teacher notes, who handed a child back, and room ratios.
export class AddChildrenChurchCare1806480000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE child_profiles
        ADD COLUMN IF NOT EXISTS emergency_contact_name character varying,
        ADD COLUMN IF NOT EXISTS emergency_contact_relationship character varying,
        ADD COLUMN IF NOT EXISTS emergency_contact_phone character varying,
        ADD COLUMN IF NOT EXISTS doctor_name character varying,
        ADD COLUMN IF NOT EXISTS doctor_phone character varying,
        ADD COLUMN IF NOT EXISTS notes_updated_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS notes_updated_at timestamptz,
        ADD COLUMN IF NOT EXISTS away_date date,
        ADD COLUMN IF NOT EXISTS away_collector_id uuid REFERENCES child_guardians(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS away_message text,
        ADD COLUMN IF NOT EXISTS away_set_by_id uuid REFERENCES members(id) ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_profiles_notes_updated_by_id ON child_profiles(notes_updated_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_profiles_away_collector_id ON child_profiles(away_collector_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_profiles_away_set_by_id ON child_profiles(away_set_by_id)`,
    );

    await queryRunner.query(`
      ALTER TABLE child_check_ins
        ADD COLUMN IF NOT EXISTS checked_out_by_id uuid REFERENCES members(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS late_notified_at timestamptz
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_check_ins_checked_out_by_id ON child_check_ins(checked_out_by_id)`,
    );
    // A child's visits newest first, and "last visit" on the admin list.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_check_ins_child_time ON child_check_ins(child_id, checkin_time DESC)`,
    );

    await queryRunner.query(
      `ALTER TABLE child_class_groups ADD COLUMN IF NOT EXISTS children_per_teacher integer`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS child_checkin_notes (
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        check_in_id uuid NOT NULL REFERENCES child_check_ins(id) ON DELETE CASCADE,
        author_id uuid REFERENCES members(id) ON DELETE SET NULL,
        from_parent boolean NOT NULL DEFAULT false,
        kind character varying NOT NULL DEFAULT 'FEEDBACK',
        text text NOT NULL,
        shared_with_parents boolean NOT NULL DEFAULT false,
        reply_to_id uuid REFERENCES child_checkin_notes(id) ON DELETE SET NULL,
        parent_seen_at timestamptz,
        parent_seen_by_id uuid REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_checkin_notes_check_in ON child_checkin_notes(check_in_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_checkin_notes_author_id ON child_checkin_notes(author_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_checkin_notes_reply_to_id ON child_checkin_notes(reply_to_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_checkin_notes_parent_seen_by_id ON child_checkin_notes(parent_seen_by_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS child_checkin_notes`);
    await queryRunner.query(
      `ALTER TABLE child_class_groups DROP COLUMN IF EXISTS children_per_teacher`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_child_check_ins_child_time`,
    );
    await queryRunner.query(`
      ALTER TABLE child_check_ins
        DROP COLUMN IF EXISTS late_notified_at,
        DROP COLUMN IF EXISTS checked_out_by_id
    `);
    await queryRunner.query(`
      ALTER TABLE child_profiles
        DROP COLUMN IF EXISTS away_set_by_id,
        DROP COLUMN IF EXISTS away_message,
        DROP COLUMN IF EXISTS away_collector_id,
        DROP COLUMN IF EXISTS away_date,
        DROP COLUMN IF EXISTS notes_updated_at,
        DROP COLUMN IF EXISTS notes_updated_by_id,
        DROP COLUMN IF EXISTS doctor_phone,
        DROP COLUMN IF EXISTS doctor_name,
        DROP COLUMN IF EXISTS emergency_contact_phone,
        DROP COLUMN IF EXISTS emergency_contact_relationship,
        DROP COLUMN IF EXISTS emergency_contact_name
    `);
  }
}
