import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrayerRequests1788912000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE prayer_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id UUID REFERENCES members(id) ON DELETE SET NULL,
        submitted_by_name character varying NOT NULL,
        content text NOT NULL,
        status character varying NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_requests_status" ON prayer_requests (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_requests_member_id" ON prayer_requests (member_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE testimonies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id UUID REFERENCES members(id) ON DELETE SET NULL,
        submitted_by_name character varying NOT NULL,
        prayer_request_id UUID REFERENCES prayer_requests(id) ON DELETE SET NULL,
        content text NOT NULL,
        is_public boolean NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_testimonies_is_public" ON testimonies (is_public)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_testimonies_member_id" ON testimonies (member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE testimonies`);
    await queryRunner.query(`DROP TABLE prayer_requests`);
  }
}
