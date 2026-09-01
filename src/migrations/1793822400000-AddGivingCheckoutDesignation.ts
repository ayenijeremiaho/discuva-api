import { MigrationInterface, QueryRunner } from 'typeorm';

// giving_checkout_sessions is a public-schema, control-plane table — these
// are plain UUID columns, not FK-enforced relations, since GivingOption and
// Pledge live in each tenant's own schema, which a public-schema table
// can't foreign-key into. See giving-checkout-session.entity.ts's header
// comment for the same reasoning already applied to tithe_account_id.
export class AddGivingCheckoutDesignation1793822400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE giving_checkout_sessions
        ADD giving_option_id UUID,
        ADD pledge_id UUID
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE giving_checkout_sessions
        DROP COLUMN giving_option_id,
        DROP COLUMN pledge_id
    `);
  }
}
