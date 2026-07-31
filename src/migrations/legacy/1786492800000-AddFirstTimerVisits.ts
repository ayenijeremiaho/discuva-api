import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstTimerVisits1786492800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE first_timer_visits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        first_timer_id UUID NOT NULL REFERENCES first_timers(id) ON DELETE CASCADE,
        event_id UUID REFERENCES events(id) ON DELETE SET NULL,
        visited_at DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE first_timer_visits`);
  }
}
