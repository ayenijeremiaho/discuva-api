import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinancePledges1784246400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_pledge_campaigns (
                id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name           VARCHAR NOT NULL,
                fund_id        UUID NOT NULL REFERENCES finance_funds(id) ON DELETE RESTRICT,
                target_amount  NUMERIC(15,2) NOT NULL,
                start_date     DATE NOT NULL,
                end_date       DATE NOT NULL,
                description    TEXT,
                is_active      BOOLEAN NOT NULL DEFAULT true,
                created_by_id  UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS finance_pledges (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                member_id     UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                campaign_id   UUID NOT NULL REFERENCES finance_pledge_campaigns(id) ON DELETE RESTRICT,
                total_amount  NUMERIC(15,2) NOT NULL,
                frequency     VARCHAR NOT NULL,
                start_date    DATE NOT NULL,
                status        VARCHAR NOT NULL DEFAULT 'ACTIVE',
                notes         TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledge_campaigns_fund ON finance_pledge_campaigns(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledge_campaigns_active ON finance_pledge_campaigns(is_active) WHERE is_active = true`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledge_campaigns_dates ON finance_pledge_campaigns(start_date, end_date)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledges_member ON finance_pledges(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON finance_pledges(campaign_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledges_status ON finance_pledges(status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pledges_member_status ON finance_pledges(member_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS finance_pledges`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_pledge_campaigns`);
  }
}
