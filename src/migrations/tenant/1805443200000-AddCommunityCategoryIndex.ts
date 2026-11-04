import { MigrationInterface, QueryRunner } from 'typeorm';

// Removing a category sets its posts to none; without this, that update reads every post.
export class AddCommunityCategoryIndex1805443200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_posts_category_id" ON team_posts (category_id) WHERE category_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_team_posts_category_id"`,
    );
  }
}
