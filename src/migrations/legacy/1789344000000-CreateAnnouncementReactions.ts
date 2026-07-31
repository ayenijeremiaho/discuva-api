import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnnouncementReactions1789344000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE announcement_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        emoji character varying NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_announcement_reactions_announcement_member" UNIQUE (announcement_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_reactions_announcement_id" ON announcement_reactions (announcement_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE announcement_reactions`);
  }
}
