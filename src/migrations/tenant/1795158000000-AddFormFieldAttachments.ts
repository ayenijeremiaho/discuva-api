import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormFieldAttachments1795158000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE form_field_attachments (
          id          UUID          NOT NULL DEFAULT gen_random_uuid(),
          form_id     UUID          NOT NULL,
          field_id    UUID          NOT NULL,
          public_id   VARCHAR       NOT NULL,
          url         VARCHAR       NOT NULL,
          resource_type VARCHAR     NOT NULL,
          created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
          CONSTRAINT "PK_form_field_attachments" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_field_attachments_public_id" ON form_field_attachments (public_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_field_attachments_created_at" ON form_field_attachments (created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_form_field_attachments_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_form_field_attachments_public_id"`,
    );
    await queryRunner.query(`DROP TABLE form_field_attachments`);
  }
}
