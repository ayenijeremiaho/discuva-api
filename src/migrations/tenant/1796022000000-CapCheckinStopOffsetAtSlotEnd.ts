import { MigrationInterface, QueryRunner } from 'typeorm';

// checkinStopOffsetSeconds/checkinStopOverride are relative to a slot's own
// startTime (see AttendanceService.validateCheckinWindow), so whether a
// configured value leaves check-in open past that specific slot's endTime
// depends on the slot's own duration — a config shared across slots of
// different lengths can't be judged in isolation. EventService.buildSlotFromDto
// now rejects this going forward; this is the one-time cleanup for existing
// rows. Only touches the offending slot's own checkin_stop_override (setting
// it explicitly, capped to that slot's duration) — never the shared
// event_configs row, so other slots using the same config are unaffected.
export class CapCheckinStopOffsetAtSlotEnd1796022000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE service_slots s
      SET checkin_stop_override = LEAST(
          COALESCE(s.checkin_stop_override, c.checkin_stop_offset_seconds),
          EXTRACT(EPOCH FROM (s.end_time - s.start_time))::int
      )
      FROM event_configs c
      WHERE s.config_id = c.id
        AND COALESCE(s.checkin_stop_override, c.checkin_stop_offset_seconds)
            > EXTRACT(EPOCH FROM (s.end_time - s.start_time))::int
    `);
  }

  public async down(): Promise<void> {
    // Not reversible — the original (invalid, past-end-time) offset values
    // are not recorded anywhere, so there is nothing to restore them to.
  }
}
