import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the CLASS audience target column, mirroring group_id exactly (see
// TenantSchemaGenesis's announcements table / FK_announcements_group_id).
export class AddClassAudienceToAnnouncements1793343600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE announcements ADD COLUMN class_id UUID NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE ONLY announcements ADD CONSTRAINT "FK_announcements_class_id" FOREIGN KEY (class_id) REFERENCES church_classes(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_announcements_class_id ON announcements USING btree (class_id);`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_announcements_class_id;`);
    await queryRunner.query(
      `ALTER TABLE announcements DROP CONSTRAINT "FK_announcements_class_id";`,
    );
    await queryRunner.query(`ALTER TABLE announcements DROP COLUMN class_id;`);
  }
}
