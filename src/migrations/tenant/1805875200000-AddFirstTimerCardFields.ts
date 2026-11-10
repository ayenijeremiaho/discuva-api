import { MigrationInterface, QueryRunner } from 'typeorm';

// The church's own first-timer card fields, answers on each first-timer, and the day they visited.
// Ready-made fields start switched off, so nothing changes until a church turns them on.
const READY_MADE: [string, string, string, string[], boolean][] = [
  ['whatsapp', 'Add me to the church WhatsApp group', 'YES_NO', [], true],
  ['visiting', 'Are you here for a visit?', 'YES_NO', [], true],
  ['gender', 'Sex', 'CHOICE', ['Female', 'Male'], true],
  [
    'age_range',
    'Age',
    'CHOICE',
    ['Under 18', '18–25', '26–35', '36–45', 'Above 45'],
    true,
  ],
  ['marital_status', 'Marital status', 'CHOICE', ['Single', 'Married'], true],
  ['birthday', 'Birthday', 'DAY_MONTH', [], false],
  ['address', 'Address', 'TEXT', [], false],
  ['nearest_bus_stop', 'Nearest bus stop', 'TEXT', [], false],
  ['occupation', 'Occupation', 'TEXT', [], false],
  ['instagram', 'Instagram', 'TEXT', [], false],
  [
    'heard_from',
    'How did you hear about us?',
    'CHOICE',
    ['Friend', 'Social media', 'Signage', 'Flyers', 'Evangelism', 'Other'],
    true,
  ],
  ['improve', 'What would you like us to do better?', 'LONG_TEXT', [], true],
  ['prayer_request', 'Prayer request', 'LONG_TEXT', [], false],
  ['attended_by', 'Attended to by', 'TEXT', [], true],
];

export class AddFirstTimerCardFields1805875200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS first_timer_fields (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key character varying(40) UNIQUE,
        label character varying(120) NOT NULL,
        type character varying(16) NOT NULL,
        options jsonb NOT NULL DEFAULT '[]',
        enabled boolean NOT NULL DEFAULT false,
        required boolean NOT NULL DEFAULT false,
        in_report boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    for (const [
      i,
      [key, label, type, options, inReport],
    ] of READY_MADE.entries()) {
      await queryRunner.query(
        `INSERT INTO first_timer_fields (key, label, type, options, in_report, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (key) DO NOTHING`,
        [key, label, type, JSON.stringify(options), inReport, i],
      );
    }

    await queryRunner.query(
      `ALTER TABLE first_timers
         ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}',
         ADD COLUMN IF NOT EXISTS visited_on date`,
    );
    await queryRunner.query(
      `UPDATE first_timers SET visited_on = (created_at AT TIME ZONE $1)::date WHERE visited_on IS NULL`,
      [process.env.TIMEZONE || 'Africa/Lagos'],
    );
    await queryRunner.query(
      `ALTER TABLE first_timers ALTER COLUMN visited_on SET DEFAULT CURRENT_DATE, ALTER COLUMN visited_on SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_first_timers_visited_on ON first_timers (visited_on)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_first_timers_visited_on`);
    await queryRunner.query(
      `ALTER TABLE first_timers DROP COLUMN IF EXISTS visited_on, DROP COLUMN IF EXISTS answers`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS first_timer_fields`);
  }
}
