import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: the network report counts visitors from other branches per month.
export class AddNetworkReportIndexes1806220800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_visitors_checkin ON network_visitors (checkin_time)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_network_visitors_checkin`,
    );
  }
}
