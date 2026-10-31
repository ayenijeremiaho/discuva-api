import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRotaUnavailability1804492800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rota_unavailability (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        date date NOT NULL,
        reason varchar(300),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rota_unavailability_member_date" UNIQUE (member_id, date)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rota_unavailability_date_member" ON rota_unavailability (date, member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE rota_unavailability`);
  }
}
