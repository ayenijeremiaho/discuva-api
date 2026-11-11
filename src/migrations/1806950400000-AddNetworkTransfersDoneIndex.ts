import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4: a member's past branches, read from their completed moves.
export class AddNetworkTransfersDoneIndex1806950400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_network_transfers_done_account ON network_transfers (account_id, decided_at DESC) WHERE status = 'DONE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_network_transfers_done_account`,
    );
  }
}
