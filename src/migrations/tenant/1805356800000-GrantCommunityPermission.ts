import { MigrationInterface, QueryRunner } from 'typeorm';

// SuperAdmin only gets the permissions that existed when its role was created, so existing churches need this one added.
export class GrantCommunityPermission1805356800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE admin_roles
       SET permissions = array_append(permissions, 'community:moderate')
       WHERE name = 'SuperAdmin' AND NOT ('community:moderate' = ANY(permissions))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE admin_roles SET permissions = array_remove(permissions, 'community:moderate') WHERE name = 'SuperAdmin'`,
    );
  }
}
