import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFormQuizVotingSupport1797836400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE forms
        ADD purpose character varying NOT NULL DEFAULT 'STANDARD',
        ADD one_response_per_member boolean NOT NULL DEFAULT false,
        ADD opens_at TIMESTAMPTZ,
        ADD closes_at TIMESTAMPTZ,
        ADD time_limit_minutes smallint,
        ADD reveal_score_immediately boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_forms_purpose" ON forms (purpose)
    `);

    await queryRunner.query(`
      ALTER TABLE form_fields
        ADD correct_options text[]
    `);

    await queryRunner.query(`
      ALTER TABLE form_submissions
        ADD score smallint,
        ADD max_score smallint
    `);

    await queryRunner.query(`
      CREATE TABLE form_attempts (
        id            UUID          NOT NULL DEFAULT gen_random_uuid(),
        form_id       UUID          NOT NULL,
        member_id     UUID          NOT NULL,
        started_at    TIMESTAMPTZ   NOT NULL,
        expires_at    TIMESTAMPTZ   NOT NULL,
        submission_id UUID,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_form_attempts" PRIMARY KEY (id),
        CONSTRAINT "FK_form_attempts_form_id" FOREIGN KEY (form_id) REFERENCES forms (id) ON DELETE CASCADE,
        CONSTRAINT "FK_form_attempts_member_id" FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
        CONSTRAINT "FK_form_attempts_submission_id" FOREIGN KEY (submission_id) REFERENCES form_submissions (id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_attempts_form_id" ON form_attempts (form_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_attempts_member_id" ON form_attempts (member_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_attempts_form_id_member_id" ON form_attempts (form_id, member_id)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_form_attempts_submission_id" ON form_attempts (submission_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE form_attempts`);

    await queryRunner.query(`
      ALTER TABLE form_submissions
        DROP COLUMN score,
        DROP COLUMN max_score
    `);

    await queryRunner.query(`
      ALTER TABLE form_fields
        DROP COLUMN correct_options
    `);

    await queryRunner.query(`DROP INDEX "IDX_forms_purpose"`);
    await queryRunner.query(`
      ALTER TABLE forms
        DROP COLUMN purpose,
        DROP COLUMN one_response_per_member,
        DROP COLUMN opens_at,
        DROP COLUMN closes_at,
        DROP COLUMN time_limit_minutes,
        DROP COLUMN reveal_score_immediately
    `);
  }
}
