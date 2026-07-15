import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceProgrammeSlotReminderSentAt1787270400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_programme_slots" ADD COLUMN "reminder_sent_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_programme_slots" DROP COLUMN "reminder_sent_at"`,
    );
  }
}
