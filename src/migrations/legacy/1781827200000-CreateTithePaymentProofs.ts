import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTithePaymentProofs1781827200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "tithe_payment_proofs" (
                "id"            uuid                     NOT NULL DEFAULT uuid_generate_v4(),
                "member_id"     uuid                     NOT NULL,
                "amount"        numeric(12,2)            NOT NULL,
                "payment_date"  date                     NOT NULL,
                "bank_name"     character varying                ,
                "reference"     character varying                ,
                "proof_url"     character varying        NOT NULL,
                "public_id"     character varying        NOT NULL,
                "resource_type" character varying        NOT NULL,
                "status"        character varying        NOT NULL DEFAULT 'PENDING',
                "reviewed_by"   uuid                             ,
                "reviewed_at"   timestamptz                      ,
                "finance_note"  character varying                ,
                "expires_at"    timestamptz              NOT NULL,
                "created_at"    timestamptz              NOT NULL DEFAULT now(),
                "updated_at"    timestamptz              NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tithe_payment_proofs" PRIMARY KEY ("id"),
                CONSTRAINT "FK_tithe_payment_proofs_member"
                    FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_tithe_payment_proofs_admin"
                    FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tithe_payment_proofs"`);
  }
}
