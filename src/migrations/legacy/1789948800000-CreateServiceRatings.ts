import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceRatings1789948800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE service_ratings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        service_slot_id UUID NOT NULL REFERENCES service_slots(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        rating SMALLINT NOT NULL,
        comment TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_service_ratings_event_slot_member" UNIQUE (event_id, service_slot_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_service_ratings_event_id" ON service_ratings (event_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE service_ratings`);
  }
}
