import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServiceProgrammeModule1782432000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE service_programmes (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                service_slot_id UUID NOT NULL UNIQUE,
                status CHARACTER VARYING NOT NULL DEFAULT 'DRAFT',
                save_as_template BOOLEAN NOT NULL DEFAULT FALSE,
                created_by_admin_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_sp_service_slot FOREIGN KEY (service_slot_id)
                    REFERENCES service_slots(id) ON DELETE CASCADE,
                CONSTRAINT fk_sp_admin FOREIGN KEY (created_by_admin_id)
                    REFERENCES admins(id) ON DELETE SET NULL
            )
        `);

    await queryRunner.query(`
            CREATE TABLE service_programme_slots (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                programme_id UUID NOT NULL,
                position INTEGER NOT NULL,
                type CHARACTER VARYING NOT NULL,
                topic CHARACTER VARYING,
                member_id UUID,
                guest_name CHARACTER VARYING,
                backup_member_id UUID,
                backup_guest_name CHARACTER VARYING,
                allocated_minutes INTEGER NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_sps_programme FOREIGN KEY (programme_id)
                    REFERENCES service_programmes(id) ON DELETE CASCADE,
                CONSTRAINT fk_sps_member FOREIGN KEY (member_id)
                    REFERENCES members(id) ON DELETE SET NULL,
                CONSTRAINT fk_sps_backup_member FOREIGN KEY (backup_member_id)
                    REFERENCES members(id) ON DELETE SET NULL
            )
        `);

    await queryRunner.query(`
            CREATE TABLE service_sessions (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                programme_id UUID NOT NULL UNIQUE,
                session_code CHARACTER VARYING NOT NULL UNIQUE,
                status CHARACTER VARYING NOT NULL DEFAULT 'LIVE',
                started_at TIMESTAMPTZ NOT NULL,
                ended_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_ss_programme FOREIGN KEY (programme_id)
                    REFERENCES service_programmes(id) ON DELETE CASCADE
            )
        `);

    await queryRunner.query(`
            CREATE TABLE service_session_slots (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                session_id UUID NOT NULL,
                programme_slot_id UUID NOT NULL,
                position INTEGER NOT NULL,
                status CHARACTER VARYING NOT NULL DEFAULT 'PENDING',
                adjusted_allocated_minutes INTEGER,
                overridden_topic CHARACTER VARYING,
                overridden_speaker_name CHARACTER VARYING,
                overridden_member_id UUID,
                actual_seconds INTEGER,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_sss_session FOREIGN KEY (session_id)
                    REFERENCES service_sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_sss_programme_slot FOREIGN KEY (programme_slot_id)
                    REFERENCES service_programme_slots(id) ON DELETE CASCADE,
                CONSTRAINT fk_sss_overridden_member FOREIGN KEY (overridden_member_id)
                    REFERENCES members(id) ON DELETE SET NULL
            )
        `);

    await queryRunner.query(`
            CREATE TABLE service_pause_entries (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                session_id UUID NOT NULL,
                slot_position INTEGER NOT NULL,
                reason CHARACTER VARYING NOT NULL,
                paused_at TIMESTAMPTZ NOT NULL,
                resumed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_spe_session FOREIGN KEY (session_id)
                    REFERENCES service_sessions(id) ON DELETE CASCADE
            )
        `);

    await queryRunner.query(`
            CREATE TABLE service_action_entries (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                session_id UUID NOT NULL,
                actor_role CHARACTER VARYING NOT NULL,
                action CHARACTER VARYING NOT NULL,
                detail CHARACTER VARYING,
                performed_by_member_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_sae_session FOREIGN KEY (session_id)
                    REFERENCES service_sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_sae_member FOREIGN KEY (performed_by_member_id)
                    REFERENCES members(id) ON DELETE SET NULL
            )
        `);

    await queryRunner.query(`
            CREATE TABLE service_programme_templates (
                id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                name CHARACTER VARYING NOT NULL,
                service_slot_name CHARACTER VARYING NOT NULL,
                slots JSONB NOT NULL DEFAULT '[]',
                created_from_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT fk_spt_programme FOREIGN KEY (created_from_id)
                    REFERENCES service_programmes(id) ON DELETE SET NULL
            )
        `);

    await queryRunner.query(
      `CREATE INDEX idx_service_programmes_slot ON service_programmes(service_slot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_programme_slots_programme ON service_programme_slots(programme_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_sessions_programme ON service_sessions(programme_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_sessions_code ON service_sessions(session_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_session_slots_session ON service_session_slots(session_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_pause_entries_session ON service_pause_entries(session_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_action_entries_session ON service_action_entries(session_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS service_programme_templates`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_action_entries`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_pause_entries`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_session_slots`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_programme_slots`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_programmes`);
  }
}
