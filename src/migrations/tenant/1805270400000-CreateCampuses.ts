import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCampuses1805270400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campuses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying NOT NULL UNIQUE,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `ALTER TABLE venues ADD COLUMN campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_venues_campus_id" ON venues (campus_id) WHERE campus_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE members ADD COLUMN home_campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_home_campus_id" ON members (home_campus_id) WHERE home_campus_id IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE member_campus_moves (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        from_campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL,
        to_campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_member_campus_moves_member" ON member_campus_moves (member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_campus_moves_to" ON member_campus_moves (to_campus_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_campus_moves_from" ON member_campus_moves (from_campus_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_campus_moves_created" ON member_campus_moves (created_at DESC)`,
    );
    await queryRunner.query(`
      CREATE TABLE worker_campus_move_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        from_campus_id uuid REFERENCES campuses(id) ON DELETE SET NULL,
        to_campus_id uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
        status character varying NOT NULL DEFAULT 'PENDING',
        decided_by_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
        decided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_worker_campus_move_pending" ON worker_campus_move_requests (member_id) WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_campus_move_requests_status" ON worker_campus_move_requests (status, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_campus_move_requests_member" ON worker_campus_move_requests (member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_campus_move_requests_to" ON worker_campus_move_requests (to_campus_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_campus_move_requests_from" ON worker_campus_move_requests (from_campus_id) WHERE from_campus_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_campus_move_requests_decider" ON worker_campus_move_requests (decided_by_member_id) WHERE decided_by_member_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE worker_campus_move_requests`);
    await queryRunner.query(`DROP TABLE member_campus_moves`);
    await queryRunner.query(`ALTER TABLE members DROP COLUMN home_campus_id`);
    await queryRunner.query(`ALTER TABLE venues DROP COLUMN campus_id`);
    await queryRunner.query(`DROP TABLE campuses`);
  }
}
