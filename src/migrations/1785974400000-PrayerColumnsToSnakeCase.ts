import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrayerColumnsToSnakeCase1785974400000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    // prayer_schedule_configs
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "isActive" TO "is_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "selectionWindowDays" TO "selection_window_days"`,
    );

    // prayer_day_configs
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "dayOfWeek" TO "day_of_week"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "startTime" TO "start_time"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "endTime" TO "end_time"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "maxCapacity" TO "max_capacity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "isActive" TO "is_active"`,
    );

    // prayer_schedule_rules
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "isActive" TO "is_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "targetLeadType" TO "target_lead_type"`,
    );

    // prayer_fixed_assignments
    await queryRunner.query(
      `ALTER TABLE "prayer_fixed_assignments" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_fixed_assignments" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_fixed_assignments" RENAME COLUMN "isActive" TO "is_active"`,
    );

    // prayer_meetings
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "currentCapacity" TO "current_capacity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "selectionStatus" TO "selection_status"`,
    );

    // prayer_roster_entries
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "assignmentType" TO "assignment_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "reminderTwoDaySent" TO "reminder_two_day_sent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "reminderDaySent" TO "reminder_day_sent"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "reminder_day_sent" TO "reminderDaySent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "reminder_two_day_sent" TO "reminderTwoDaySent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "assignment_type" TO "assignmentType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_roster_entries" RENAME COLUMN "created_at" TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "selection_status" TO "selectionStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "current_capacity" TO "currentCapacity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_meetings" RENAME COLUMN "created_at" TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE "prayer_fixed_assignments" RENAME COLUMN "is_active" TO "isActive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_fixed_assignments" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_fixed_assignments" RENAME COLUMN "created_at" TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "target_lead_type" TO "targetLeadType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "is_active" TO "isActive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_rules" RENAME COLUMN "created_at" TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "is_active" TO "isActive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "max_capacity" TO "maxCapacity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "end_time" TO "endTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "start_time" TO "startTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "day_of_week" TO "dayOfWeek"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_day_configs" RENAME COLUMN "created_at" TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "selection_window_days" TO "selectionWindowDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "is_active" TO "isActive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prayer_schedule_configs" RENAME COLUMN "created_at" TO "createdAt"`,
    );
  }
}
