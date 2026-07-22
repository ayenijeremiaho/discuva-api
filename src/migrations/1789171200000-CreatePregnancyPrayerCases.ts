import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePregnancyPrayerCases1789171200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pregnancy_prayer_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id UUID REFERENCES members(id) ON DELETE SET NULL,
        name character varying NOT NULL,
        edd date NOT NULL,
        details text,
        status character varying NOT NULL DEFAULT 'ACTIVE',
        last_prayed_at TIMESTAMPTZ,
        created_by UUID REFERENCES members(id) ON DELETE SET NULL,
        created_by_name character varying NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_pregnancy_prayer_cases_member_id" ON pregnancy_prayer_cases (member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pregnancy_prayer_cases_status" ON pregnancy_prayer_cases (status)`,
    );

    await queryRunner.query(`
      CREATE TABLE pregnancy_prayer_visits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES pregnancy_prayer_cases(id) ON DELETE CASCADE,
        logged_by UUID REFERENCES members(id) ON DELETE SET NULL,
        logged_by_name character varying NOT NULL,
        note text,
        visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_pregnancy_prayer_visits_case_id" ON pregnancy_prayer_visits (case_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE pregnancy_prayer_visits`);
    await queryRunner.query(`DROP TABLE pregnancy_prayer_cases`);
  }
}
