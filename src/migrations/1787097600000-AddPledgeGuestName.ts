import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPledgeGuestName1787097600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_pledges
      ADD COLUMN guest_name character varying NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE finance_pledges
      DROP COLUMN guest_name
    `);
  }
}
