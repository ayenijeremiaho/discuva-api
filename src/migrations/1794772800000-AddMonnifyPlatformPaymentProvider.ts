import { MigrationInterface, QueryRunner } from 'typeorm';

// Off until the platform sets MONNIFY_* keys and switches it on in the platform portal.
export class AddMonnifyPlatformPaymentProvider1794772800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO payment_providers (id, name, is_active) VALUES ('monnify', 'Monnify (Moniepoint)', false)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM payment_providers WHERE id = 'monnify'`,
    );
  }
}
