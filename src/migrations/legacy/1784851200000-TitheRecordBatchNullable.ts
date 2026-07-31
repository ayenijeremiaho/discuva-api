import { MigrationInterface, QueryRunner } from 'typeorm';

export class TitheRecordBatchNullable1784851200000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tithe_records ALTER COLUMN batch_id DROP NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tithe_records ALTER COLUMN batch_id SET NOT NULL`,
    );
  }
}
