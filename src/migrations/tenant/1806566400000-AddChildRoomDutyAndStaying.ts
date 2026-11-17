import { MigrationInterface, QueryRunner } from 'typeorm';

// Which room each teacher is serving in per day, and children who stay for every service that day.
export class AddChildRoomDutyAndStaying1806566400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS child_room_duties (
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        class_group_id uuid REFERENCES child_class_groups(id) ON DELETE CASCADE,
        day date NOT NULL
      )
    `);
    // One pick per teacher per day; a backward scan finds their last pick.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_child_room_duties_member_day ON child_room_duties(member_id, day)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_room_duties_day_room ON child_room_duties(day, class_group_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_room_duties_class_group_id ON child_room_duties(class_group_id)`,
    );

    await queryRunner.query(
      `ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS stays_all_services boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins ADD COLUMN IF NOT EXISTS staying_all_services boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE child_check_ins DROP COLUMN IF EXISTS staying_all_services`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles DROP COLUMN IF EXISTS stays_all_services`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS child_room_duties`);
  }
}
