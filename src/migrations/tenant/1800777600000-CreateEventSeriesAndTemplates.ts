import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventSeriesAndTemplates1800777600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS event_series (
          id                         UUID              NOT NULL DEFAULT gen_random_uuid(),
          name                       CHARACTER VARYING NOT NULL,
          description                CHARACTER VARYING,
          online_attendance_enabled  BOOLEAN           NOT NULL DEFAULT false,
          recurrence_pattern         CHARACTER VARYING NOT NULL,
          recurrence_interval        INT               NOT NULL DEFAULT 1,
          start_date                 DATE              NOT NULL,
          end_date                   DATE,
          slot_blueprint             JSONB             NOT NULL DEFAULT '[]',
          auto_programme             BOOLEAN           NOT NULL DEFAULT true,
          generated_through          DATE,
          is_active                  BOOLEAN           NOT NULL DEFAULT true,
          created_by                 UUID,
          created_at                 TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at                 TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_event_series" PRIMARY KEY (id),
          CONSTRAINT "FK_event_series_created_by" FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    // The nightly top-up only reads active series.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_event_series_active" ON event_series (generated_through) WHERE is_active`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS event_templates (
          id                         UUID              NOT NULL DEFAULT gen_random_uuid(),
          name                       CHARACTER VARYING NOT NULL,
          description                CHARACTER VARYING,
          online_attendance_enabled  BOOLEAN           NOT NULL DEFAULT false,
          slot_blueprint             JSONB             NOT NULL DEFAULT '[]',
          default_recurrence         JSONB,
          auto_programme             BOOLEAN           NOT NULL DEFAULT true,
          created_at                 TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at                 TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_event_templates" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_event_templates_name" ON event_templates (LOWER(name))`,
    );

    // The occurrence's date in the series (church-local), so each date is generated once.
    await queryRunner.query(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS series_occurrence_date DATE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_events_series_occurrence" ON events (recurring_event_id, series_occurrence_date) WHERE series_occurrence_date IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_events_recurring_start" ON events (recurring_event_id, start_time) WHERE recurring_event_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_events_recurring_start"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_events_series_occurrence"`,
    );
    await queryRunner.query(
      `ALTER TABLE events DROP COLUMN IF EXISTS series_occurrence_date`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS event_templates`);
    await queryRunner.query(`DROP TABLE IF EXISTS event_series`);
  }
}
