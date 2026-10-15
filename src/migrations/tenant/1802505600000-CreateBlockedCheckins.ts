import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBlockedCheckins1802505600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS blocked_checkins (
          id                       UUID              NOT NULL DEFAULT gen_random_uuid(),
          member_id                UUID              NOT NULL,
          event_id                 UUID              NOT NULL,
          service_slot_id          UUID              NULL,
          attempts                 INT               NOT NULL DEFAULT 1,
          closest_distance_meters  INT               NOT NULL,
          accuracy_meters          INT               NULL,
          allowed_distance_meters  INT               NOT NULL,
          reason                   CHARACTER VARYING NOT NULL,
          last_attempt_at          TIMESTAMPTZ       NOT NULL,
          created_at               TIMESTAMPTZ       NOT NULL DEFAULT now(),
          updated_at               TIMESTAMPTZ       NOT NULL DEFAULT now(),
          CONSTRAINT "PK_blocked_checkins" PRIMARY KEY (id),
          CONSTRAINT "UQ_blocked_checkins_member_event" UNIQUE (member_id, event_id),
          CONSTRAINT "FK_blocked_checkins_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
          CONSTRAINT "FK_blocked_checkins_event" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          CONSTRAINT "FK_blocked_checkins_service_slot" FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE SET NULL
      )
    `);
    // Admin list: newest first, optionally for one event.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_blocked_checkins_last_attempt" ON blocked_checkins (last_attempt_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_blocked_checkins_event_last_attempt" ON blocked_checkins (event_id, last_attempt_at DESC)`,
    );
    // ON DELETE SET NULL from service_slots.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_blocked_checkins_service_slot_id" ON blocked_checkins (service_slot_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS blocked_checkins`);
  }
}
