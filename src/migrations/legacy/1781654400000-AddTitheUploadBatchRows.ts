import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTitheUploadBatchRows1781654400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tithe_upload_batches" ADD COLUMN "rows" jsonb NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tithe_upload_batches" DROP COLUMN "rows"`,
    );
  }
}
