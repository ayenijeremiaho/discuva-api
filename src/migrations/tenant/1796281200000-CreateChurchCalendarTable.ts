import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChurchCalendarTable1796281200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE church_calendars (
          id            UUID          NOT NULL DEFAULT gen_random_uuid(),
          title         VARCHAR       NOT NULL,
          theme         VARCHAR,
          start_date    DATE          NOT NULL,
          end_date      DATE          NOT NULL,
          accent_color  VARCHAR,
          is_published  BOOLEAN       NOT NULL DEFAULT false,
          entries       JSONB         NOT NULL DEFAULT '[]',
          created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
          CONSTRAINT "PK_church_calendars" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_church_calendars_end_date" ON church_calendars (end_date)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_church_calendars_end_date"`);
    await queryRunner.query(`DROP TABLE church_calendars`);
  }
}
