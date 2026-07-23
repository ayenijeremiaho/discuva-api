import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGames1789603200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE games (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title character varying NOT NULL,
        description text,
        status character varying NOT NULL DEFAULT 'DRAFT',
        created_by_id UUID REFERENCES admins(id) ON DELETE SET NULL,
        department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
        church_class_id UUID REFERENCES church_classes(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE game_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        "order" INT NOT NULL,
        question_text text NOT NULL,
        options jsonb NOT NULL,
        correct_option_index INT NOT NULL,
        points INT NOT NULL DEFAULT 1000,
        time_limit_seconds INT NOT NULL DEFAULT 20,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_game_questions_game_id" ON game_questions (game_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE game_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        session_code character varying NOT NULL UNIQUE,
        status character varying NOT NULL DEFAULT 'SCHEDULED',
        host_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
        current_question_index INT,
        current_question_started_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_game_sessions_game_id" ON game_sessions (game_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE game_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        total_score INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_game_participants_session_member" UNIQUE (session_id, member_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_game_participants_session_id" ON game_participants (session_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE game_responses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
        question_id UUID NOT NULL REFERENCES game_questions(id) ON DELETE CASCADE,
        participant_id UUID NOT NULL REFERENCES game_participants(id) ON DELETE CASCADE,
        selected_option_index INT NOT NULL,
        is_correct boolean NOT NULL,
        points_awarded INT NOT NULL,
        answered_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_game_responses_session_question_participant" UNIQUE (session_id, question_id, participant_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_game_responses_session_id" ON game_responses (session_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE game_responses`);
    await queryRunner.query(`DROP TABLE game_participants`);
    await queryRunner.query(`DROP TABLE game_sessions`);
    await queryRunner.query(`DROP TABLE game_questions`);
    await queryRunner.query(`DROP TABLE games`);
  }
}
