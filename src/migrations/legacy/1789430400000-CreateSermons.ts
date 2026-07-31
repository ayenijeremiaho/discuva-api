import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSermons1789430400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sermons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title character varying NOT NULL,
        speaker_name character varying NOT NULL,
        date TIMESTAMPTZ NOT NULL,
        description text,
        youtube_url character varying,
        mixlr_url character varying,
        series character varying,
        created_by_id UUID REFERENCES admins(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sermons_date" ON sermons (date)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sermons_series" ON sermons (series)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE sermons`);
  }
}
