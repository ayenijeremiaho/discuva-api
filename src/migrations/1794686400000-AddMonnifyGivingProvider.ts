import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMonnifyGivingProvider1794686400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO giving_providers (id, name) VALUES ('monnify', 'Monnify (Moniepoint)')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM giving_providers WHERE id = 'monnify'`,
    );
  }
}
