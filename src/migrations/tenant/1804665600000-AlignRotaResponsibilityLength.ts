import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignRotaResponsibilityLength1804665600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE rota_responsibilities ALTER COLUMN name TYPE varchar(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_custom_assignments ALTER COLUMN role TYPE varchar(80)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE rota_responsibilities ALTER COLUMN name TYPE varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE rota_custom_assignments ALTER COLUMN role TYPE varchar(100)`,
    );
  }
}
