import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEvangelismConverts1789257600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE converts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying NOT NULL,
        phone character varying,
        notes text,
        status character varying NOT NULL DEFAULT 'UNSAVED',
        onboarded_by UUID REFERENCES members(id) ON DELETE SET NULL,
        onboarded_by_name character varying NOT NULL,
        assigned_to UUID REFERENCES worker_profiles(id) ON DELETE SET NULL,
        member_id UUID REFERENCES members(id) ON DELETE SET NULL,
        linked_at TIMESTAMPTZ,
        last_contacted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_status" ON converts (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_onboarded_by" ON converts (onboarded_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_assigned_to" ON converts (assigned_to)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_member_id" ON converts (member_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE convert_follow_up_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        convert_id UUID NOT NULL REFERENCES converts(id) ON DELETE CASCADE,
        logged_by UUID REFERENCES members(id) ON DELETE SET NULL,
        logged_by_name character varying NOT NULL,
        note text,
        contacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_convert_follow_up_logs_convert_id" ON convert_follow_up_logs (convert_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE convert_follow_up_logs`);
    await queryRunner.query(`DROP TABLE converts`);
  }
}
