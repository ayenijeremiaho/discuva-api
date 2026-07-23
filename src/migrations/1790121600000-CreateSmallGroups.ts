import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSmallGroups1790121600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE small_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying NOT NULL UNIQUE,
        description TEXT NULL,
        leader_id UUID NULL REFERENCES members(id) ON DELETE SET NULL,
        meeting_day character varying NULL,
        meeting_location character varying NULL,
        created_by_id UUID NULL REFERENCES admins(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE small_group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES small_groups(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_small_group_members_group_member" UNIQUE (group_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_members_group_id" ON small_group_members (group_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE small_group_attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES small_groups(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        meeting_date DATE NOT NULL,
        status character varying NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_small_group_attendance_group_member_date" UNIQUE (group_id, member_id, meeting_date)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_attendance_group_id" ON small_group_attendance (group_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE small_group_attendance`);
    await queryRunner.query(`DROP TABLE small_group_members`);
    await queryRunner.query(`DROP TABLE small_groups`);
  }
}
