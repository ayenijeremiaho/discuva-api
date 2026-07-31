import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrayerPrograms1786233600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE prayer_programs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name CHARACTER VARYING NOT NULL,
        description TEXT,
        audience CHARACTER VARYING NOT NULL DEFAULT 'WORKERS',
        selection_window_days INTEGER NOT NULL DEFAULT 7,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO prayer_programs (name, audience, selection_window_days, is_active)
      VALUES ('Prayer Program', 'WORKERS', 7, true)
    `);

    await queryRunner.query(`
      ALTER TABLE prayer_day_configs ADD COLUMN program_id UUID
    `);
    await queryRunner.query(`
      UPDATE prayer_day_configs SET program_id = (SELECT id FROM prayer_programs LIMIT 1)
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_day_configs ALTER COLUMN program_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_day_configs
        ADD CONSTRAINT fk_prayer_day_config_program
        FOREIGN KEY (program_id) REFERENCES prayer_programs(id) ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE prayer_schedule_rules ADD COLUMN program_id UUID
    `);
    await queryRunner.query(`
      UPDATE prayer_schedule_rules SET program_id = (SELECT id FROM prayer_programs LIMIT 1)
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_schedule_rules ALTER COLUMN program_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_schedule_rules
        ADD CONSTRAINT fk_prayer_schedule_rule_program
        FOREIGN KEY (program_id) REFERENCES prayer_programs(id) ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE prayer_meetings ADD COLUMN program_id UUID
    `);
    await queryRunner.query(`
      UPDATE prayer_meetings SET program_id = (SELECT id FROM prayer_programs LIMIT 1)
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_meetings ALTER COLUMN program_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_meetings
        ADD CONSTRAINT fk_prayer_meeting_program
        FOREIGN KEY (program_id) REFERENCES prayer_programs(id) ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE prayer_roster_entries
        ADD COLUMN member_id UUID,
        ADD CONSTRAINT fk_prayer_roster_entry_member
          FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE prayer_roster_entries
        ALTER COLUMN worker_profile_id DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE prayer_roster_entries ALTER COLUMN worker_profile_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_roster_entries
        DROP CONSTRAINT fk_prayer_roster_entry_member,
        DROP COLUMN member_id
    `);

    await queryRunner.query(`
      ALTER TABLE prayer_meetings DROP CONSTRAINT fk_prayer_meeting_program, DROP COLUMN program_id
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_schedule_rules DROP CONSTRAINT fk_prayer_schedule_rule_program, DROP COLUMN program_id
    `);
    await queryRunner.query(`
      ALTER TABLE prayer_day_configs DROP CONSTRAINT fk_prayer_day_config_program, DROP COLUMN program_id
    `);

    await queryRunner.query(`DROP TABLE prayer_programs`);
  }
}
