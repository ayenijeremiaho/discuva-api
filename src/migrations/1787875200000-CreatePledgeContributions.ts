import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePledgeContributions1787875200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_pledge_contributions (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                pledge_id       UUID NOT NULL REFERENCES finance_pledges(id) ON DELETE CASCADE,
                submitted_by_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                amount          NUMERIC(15,2) NOT NULL,
                payment_date    DATE NOT NULL,
                reference       VARCHAR,
                status          VARCHAR NOT NULL DEFAULT 'PENDING',
                reviewed_by     UUID REFERENCES admins(id) ON DELETE SET NULL,
                reviewed_at     TIMESTAMPTZ,
                finance_note    VARCHAR,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledge_contributions_pledge ON finance_pledge_contributions(pledge_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledge_contributions_status ON finance_pledge_contributions(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledge_contributions_submitted_by ON finance_pledge_contributions(submitted_by_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS finance_pledge_contributions`,
    );
  }
}
