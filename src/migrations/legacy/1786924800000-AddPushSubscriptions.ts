import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushSubscriptions1786924800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "member_id" uuid NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_push_subscriptions_member" UNIQUE ("member_id"),
        CONSTRAINT "FK_push_subscriptions_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
