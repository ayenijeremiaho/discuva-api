import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSmartRotaSetup1804406400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rota_subteams (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL,
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_subteams_department_name" UNIQUE (department_id, name)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_subteams_department_position" ON rota_subteams (department_id, position, name)`,
    );

    await queryRunner.query(`
      CREATE TABLE rota_responsibilities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        subteam_id uuid REFERENCES rota_subteams(id) ON DELETE SET NULL,
        name varchar(100) NOT NULL,
        required_count smallint NOT NULL DEFAULT 1 CHECK (required_count BETWEEN 1 AND 50),
        allocation_mode varchar(16) NOT NULL DEFAULT 'MANUAL' CHECK (allocation_mode IN ('MANUAL', 'FIXED', 'AUTOMATIC')),
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_responsibilities_department_name" UNIQUE (department_id, name)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_responsibilities_department_subteam_position" ON rota_responsibilities (department_id, subteam_id, position, name)`,
    );

    await queryRunner.query(`
      CREATE TABLE rota_responsibility_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        responsibility_id uuid NOT NULL REFERENCES rota_responsibilities(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        is_fixed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_responsibility_members_pair" UNIQUE (responsibility_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_responsibility_members_member_responsibility" ON rota_responsibility_members (member_id, responsibility_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE rota_planner_grants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        subteam_id uuid REFERENCES rota_subteams(id) ON DELETE CASCADE,
        can_publish boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_rota_planner_grants_department_member" ON rota_planner_grants (department_id, member_id) WHERE subteam_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_rota_planner_grants_subteam_member" ON rota_planner_grants (subteam_id, member_id) WHERE subteam_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_planner_grants_member_department" ON rota_planner_grants (member_id, department_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE rota_schedules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL,
        schedule_type varchar(20) NOT NULL CHECK (schedule_type IN ('SERVICE_SLOTS', 'CUSTOM')),
        allocation_mode varchar(16) NOT NULL DEFAULT 'MANUAL' CHECK (allocation_mode IN ('MANUAL', 'FIXED', 'AUTOMATIC')),
        day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
        start_time time,
        end_time time,
        active boolean NOT NULL DEFAULT true,
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_schedules_department_name" UNIQUE (department_id, name),
        CONSTRAINT "CHK_rota_schedules_custom_time" CHECK (
          schedule_type = 'SERVICE_SLOTS' OR
          (day_of_week IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_schedules_department_active_position" ON rota_schedules (department_id, active, position, name)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE rota_schedules`);
    await queryRunner.query(`DROP TABLE rota_planner_grants`);
    await queryRunner.query(`DROP TABLE rota_responsibility_members`);
    await queryRunner.query(`DROP TABLE rota_responsibilities`);
    await queryRunner.query(`DROP TABLE rota_subteams`);
  }
}
