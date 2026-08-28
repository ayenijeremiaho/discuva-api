import { MigrationInterface, QueryRunner } from 'typeorm';

// cleanupMaterialAsset() (ClassesService) runs a `WHERE public_id = :x AND
// id != :y` existence check on every material/class deletion to decide
// whether a shared Cloudinary asset is still referenced elsewhere — that
// query had no index to use until now.
export class AddClassMaterialsPublicIdIndex1793862000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_class_materials_public_id" ON class_materials (public_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_class_materials_public_id"`);
  }
}
