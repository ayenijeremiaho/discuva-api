import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceDepartmentKeyWithCapabilities1790208000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE departments ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}'
    `);

    // Old free-form key -> new fixed capability. Anything not in this map
    // (custom/unused keys like WORSHIP, USHERING, etc.) had no real behavior
    // behind it and is simply dropped.
    await queryRunner.query(`
      UPDATE departments
      SET capabilities = CASE key
        WHEN 'ADMIN' THEN ARRAY['FRONT_DESK_OPERATIONS']
        WHEN 'EVANGELISM' THEN ARRAY['MANAGE_EVANGELISM_CONVERTS']
        WHEN 'SUNDAY_SCHOOL' THEN ARRAY['MANAGE_SUNDAY_SCHOOL']
        WHEN 'PRAYER' THEN ARRAY['MANAGE_PRAYER_REQUESTS']
        WHEN 'CHILDREN_CHURCH' THEN ARRAY['MANAGE_CHILDREN_CHURCH']
        WHEN 'FOLLOW_UP' THEN ARRAY['MANAGE_FOLLOW_UP']
        ELSE '{}'
      END
      WHERE key IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE departments DROP COLUMN key
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE departments ADD COLUMN key character varying NULL DEFAULT NULL
    `);

    await queryRunner.query(`
      UPDATE departments
      SET key = CASE
        WHEN 'FRONT_DESK_OPERATIONS' = ANY(capabilities) THEN 'ADMIN'
        WHEN 'MANAGE_EVANGELISM_CONVERTS' = ANY(capabilities) THEN 'EVANGELISM'
        WHEN 'MANAGE_SUNDAY_SCHOOL' = ANY(capabilities) THEN 'SUNDAY_SCHOOL'
        WHEN 'MANAGE_PRAYER_REQUESTS' = ANY(capabilities) THEN 'PRAYER'
        WHEN 'MANAGE_CHILDREN_CHURCH' = ANY(capabilities) THEN 'CHILDREN_CHURCH'
        WHEN 'MANAGE_FOLLOW_UP' = ANY(capabilities) THEN 'FOLLOW_UP'
        ELSE NULL
      END
      WHERE array_length(capabilities, 1) > 0
    `);

    await queryRunner.query(`
      ALTER TABLE departments DROP COLUMN capabilities
    `);
  }
}
