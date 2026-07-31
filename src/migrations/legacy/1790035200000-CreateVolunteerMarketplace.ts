import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVolunteerMarketplace1790035200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE volunteer_opportunities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title character varying NOT NULL,
        description TEXT NULL,
        department_id UUID NULL REFERENCES departments(id) ON DELETE SET NULL,
        date TIMESTAMPTZ NOT NULL,
        capacity INT NULL,
        confirmed_count INT NOT NULL DEFAULT 0,
        status character varying NOT NULL DEFAULT 'OPEN',
        created_by_id UUID NULL REFERENCES admins(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_volunteer_opportunities_date" ON volunteer_opportunities (date)`,
    );

    await queryRunner.query(`
      CREATE TABLE volunteer_signups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        opportunity_id UUID NOT NULL REFERENCES volunteer_opportunities(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        status character varying NOT NULL DEFAULT 'CONFIRMED',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_volunteer_signups_opportunity_member" UNIQUE (opportunity_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_volunteer_signups_opportunity_id" ON volunteer_signups (opportunity_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE volunteer_signups`);
    await queryRunner.query(`DROP TABLE volunteer_opportunities`);
  }
}
