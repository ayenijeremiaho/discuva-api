import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames every camelCase column that InitialSchema created to its snake_case
 * equivalent so that subsequent migrations (which already use snake_case) and
 * the SnakeNamingStrategy used by TypeORM at runtime all agree on column names.
 */
export class NormalizeColumnsToSnakeCase1749760000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    // ── members ──────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "createdAt"             TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "updatedAt"             TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "phoneNumber"           TO phone_number`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "changedPassword"       TO changed_password`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "deviceId"              TO device_id`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "dateOfBirth"           TO date_of_birth`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "maritalStatus"         TO marital_status`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "yearBornAgain"         TO year_born_again`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "yearBaptized"          TO year_baptized`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "baptizedWithHolyGhost" TO baptized_with_holy_ghost`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN "yearJoinedChurch"      TO year_joined_church`,
    );

    // ── venues ───────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE venues RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE venues RENAME COLUMN "updatedAt" TO updated_at`,
    );

    // ── departments ──────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE departments RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE departments RENAME COLUMN "updatedAt" TO updated_at`,
    );

    // ── admin_roles ──────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE admin_roles RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE admin_roles RENAME COLUMN "updatedAt" TO updated_at`,
    );

    // ── events ───────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE events RENAME COLUMN "createdAt"        TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE events RENAME COLUMN "updatedAt"        TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE events RENAME COLUMN "recurringEventId" TO recurring_event_id`,
    );

    // ── notes ────────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE notes RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE notes RENAME COLUMN "updatedAt" TO updated_at`,
    );

    // ── password_reset_otps ──────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN "memberId"  TO member_id`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN "otpHash"   TO otp_hash`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN "expiresAt" TO expires_at`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN "usedAt"    TO used_at`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN "createdAt" TO created_at`,
    );

    // ── device_reset_otps ────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN "memberId"    TO member_id`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN "otpHash"     TO otp_hash`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN "newDeviceId" TO new_device_id`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN "expiresAt"   TO expires_at`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN "usedAt"      TO used_at`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN "createdAt"   TO created_at`,
    );

    // ── child_age_groups ─────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN "createdAt"    TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN "updatedAt"    TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN "minAgeMonths" TO min_age_months`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN "maxAgeMonths" TO max_age_months`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN "displayOrder" TO display_order`,
    );

    // ── admins ───────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE admins RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE admins RENAME COLUMN "updatedAt" TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE admins RENAME COLUMN "isActive"  TO is_active`,
    );

    // ── member_sessions ──────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN "createdAt"          TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN "updatedAt"          TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN "lastLogin"          TO last_login`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN "lastLogout"         TO last_logout`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN "hashedRefreshToken" TO hashed_refresh_token`,
    );

    // ── audit_logs ───────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN "createdAt"   TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN "actorId"     TO actor_id`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN "targetId"    TO target_id`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN "targetEmail" TO target_email`,
    );

    // ── birthday_wishes ──────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN "createdAt"   TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN "updatedAt"   TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN "recipientId" TO recipient_id`,
    );
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN "senderId"    TO sender_id`,
    );

    // ── sunday_school_classes ────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE sunday_school_classes RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_classes RENAME COLUMN "updatedAt" TO updated_at`,
    );

    // ── worker_profiles ──────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN "createdAt"            TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN "updatedAt"            TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN "yearJoinedWorkforce"  TO year_joined_workforce`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN "completedSOD"         TO completed_sod`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN "completedBibleCollege" TO completed_bible_college`,
    );

    // ── department_leads ─────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE department_leads RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE department_leads RENAME COLUMN "updatedAt" TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE department_leads RENAME COLUMN "leadType"  TO lead_type`,
    );

    // ── request_leave ────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN "updatedAt" TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN "dateFrom"  TO date_from`,
    );
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN "dateTo"    TO date_to`,
    );

    // ── event_config ─────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE event_config RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE event_config RENAME COLUMN "updatedAt" TO updated_at`,
    );

    // ── service_slots ────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE service_slots RENAME COLUMN "createdAt"    TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots RENAME COLUMN "updatedAt"    TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots RENAME COLUMN "markedAbsent" TO marked_absent`,
    );

    // ── event_reminders ──────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE event_reminders RENAME COLUMN "createdAt"     TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE event_reminders RENAME COLUMN "updatedAt"     TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE event_reminders RENAME COLUMN "intervalPreset" TO interval_preset`,
    );

    // ── attendances ──────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN "createdAt"    TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN "updatedAt"    TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN "checkinTime"  TO checkin_time`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN "roleAtCheckin" TO role_at_checkin`,
    );

    // ── church_classes ───────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN "createdAt"    TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN "updatedAt"    TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN "startDate"    TO start_date`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN "endDate"      TO end_date`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN "facilitatorId" TO facilitator_id`,
    );

    // ── class_enrollments ────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "createdAt"    TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "updatedAt"    TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "enrolledAt"   TO enrolled_at`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "completedAt"  TO completed_at`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "cancelledAt"  TO cancelled_at`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "memberId"     TO member_id`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN "churchClassId" TO church_class_id`,
    );

    // ── announcements ────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "createdAt"      TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "updatedAt"      TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "publishedAt"    TO published_at`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "expiresAt"      TO expires_at`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "authorId"       TO author_id`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "departmentId"   TO department_id`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN "targetMemberId" TO target_member_id`,
    );

    // ── sunday_school_members ────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE sunday_school_members RENAME COLUMN "createdAt" TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_members RENAME COLUMN "updatedAt" TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_members RENAME COLUMN "assignedAt" TO assigned_at`,
    );

    // ── sunday_school_sessions ───────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN "createdAt"   TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN "updatedAt"   TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN "sessionDate" TO session_date`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN "selfMarkOpen" TO self_mark_open`,
    );

    // ── sunday_school_attendances ────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN "createdAt"       TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN "updatedAt"       TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN "markedByTeacher" TO marked_by_teacher`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN "markedAt"        TO marked_at`,
    );

    // ── child_class_groups ───────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE child_class_groups RENAME COLUMN "createdAt"   TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_class_groups RENAME COLUMN "updatedAt"   TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_class_groups RENAME COLUMN "teacherNote" TO teacher_note`,
    );

    // ── child_profiles ───────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN "createdAt"    TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN "updatedAt"    TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN "dateOfBirth"  TO date_of_birth`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN "photoUrl"     TO photo_url`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN "specialNotes" TO special_notes`,
    );

    // ── child_guardians ──────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN "createdAt"          TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN "updatedAt"          TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN "fullName"           TO full_name`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN "phoneNumber"        TO phone_number`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN "photoUrl"           TO photo_url`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN "isAuthorizedPickup" TO is_authorized_pickup`,
    );

    // ── child_check_ins ──────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "createdAt"       TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "updatedAt"       TO updated_at`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "checkinTime"     TO checkin_time`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "checkoutTime"    TO checkout_time`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "pickupCode"      TO pickup_code`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "droppedOffByName" TO dropped_off_by_name`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "pickedUpByName"  TO picked_up_by_name`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN "flagReason"      TO flag_reason`,
    );

    // ── email_logs ───────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN "createdAt"     TO created_at`,
    );
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN "jobId"         TO job_id`,
    );
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN "errorMessage"  TO error_message`,
    );
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN "attemptsMade"  TO attempts_made`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN attempts_made  TO "attemptsMade"`,
    );
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN error_message  TO "errorMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN job_id         TO "jobId"`,
    );
    await queryRunner.query(
      `ALTER TABLE email_logs RENAME COLUMN created_at     TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN flag_reason       TO "flagReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN picked_up_by_name TO "pickedUpByName"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN dropped_off_by_name TO "droppedOffByName"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN pickup_code       TO "pickupCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN checkout_time     TO "checkoutTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN checkin_time      TO "checkinTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN updated_at        TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_check_ins RENAME COLUMN created_at        TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN is_authorized_pickup TO "isAuthorizedPickup"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN photo_url           TO "photoUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN phone_number        TO "phoneNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN full_name           TO "fullName"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN updated_at          TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_guardians RENAME COLUMN created_at          TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN special_notes TO "specialNotes"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN photo_url     TO "photoUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN date_of_birth TO "dateOfBirth"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN updated_at    TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_profiles RENAME COLUMN created_at    TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE child_class_groups RENAME COLUMN teacher_note TO "teacherNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_class_groups RENAME COLUMN updated_at   TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_class_groups RENAME COLUMN created_at   TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN marked_by_teacher TO "markedByTeacher"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN marked_at         TO "markedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN updated_at        TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_attendances RENAME COLUMN created_at        TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN self_mark_open TO "selfMarkOpen"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN session_date   TO "sessionDate"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN updated_at     TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_sessions RENAME COLUMN created_at     TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE sunday_school_members RENAME COLUMN assigned_at TO "assignedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_members RENAME COLUMN updated_at  TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_members RENAME COLUMN created_at  TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN target_member_id TO "targetMemberId"`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN department_id    TO "departmentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN author_id        TO "authorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN expires_at       TO "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN published_at     TO "publishedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN updated_at       TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE announcements RENAME COLUMN created_at       TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN church_class_id TO "churchClassId"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN member_id       TO "memberId"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN cancelled_at    TO "cancelledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN completed_at    TO "completedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN enrolled_at     TO "enrolledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN updated_at      TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE class_enrollments RENAME COLUMN created_at      TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN facilitator_id TO "facilitatorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN end_date        TO "endDate"`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN start_date      TO "startDate"`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN updated_at      TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE church_classes RENAME COLUMN created_at      TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN role_at_checkin TO "roleAtCheckin"`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN checkin_time    TO "checkinTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN updated_at      TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE attendances RENAME COLUMN created_at      TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE event_reminders RENAME COLUMN interval_preset TO "intervalPreset"`,
    );
    await queryRunner.query(
      `ALTER TABLE event_reminders RENAME COLUMN updated_at      TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE event_reminders RENAME COLUMN created_at      TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE service_slots RENAME COLUMN marked_absent TO "markedAbsent"`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots RENAME COLUMN updated_at    TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE service_slots RENAME COLUMN created_at    TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE event_config RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE event_config RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN date_to    TO "dateTo"`,
    );
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN date_from  TO "dateFrom"`,
    );
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE request_leave RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE department_leads RENAME COLUMN lead_type   TO "leadType"`,
    );
    await queryRunner.query(
      `ALTER TABLE department_leads RENAME COLUMN updated_at  TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE department_leads RENAME COLUMN created_at  TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN completed_bible_college TO "completedBibleCollege"`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN completed_sod          TO "completedSOD"`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN year_joined_workforce  TO "yearJoinedWorkforce"`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN updated_at             TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_profiles RENAME COLUMN created_at             TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE sunday_school_classes RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE sunday_school_classes RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN sender_id    TO "senderId"`,
    );
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN recipient_id TO "recipientId"`,
    );
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN updated_at   TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE birthday_wishes RENAME COLUMN created_at   TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN target_email TO "targetEmail"`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN target_id    TO "targetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN actor_id     TO "actorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_logs RENAME COLUMN created_at   TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN hashed_refresh_token TO "hashedRefreshToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN last_logout          TO "lastLogout"`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN last_login           TO "lastLogin"`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN updated_at           TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE member_sessions RENAME COLUMN created_at           TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE admins RENAME COLUMN is_active  TO "isActive"`,
    );
    await queryRunner.query(
      `ALTER TABLE admins RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE admins RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN display_order  TO "displayOrder"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN max_age_months TO "maxAgeMonths"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN min_age_months TO "minAgeMonths"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN updated_at     TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE child_age_groups RENAME COLUMN created_at     TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN created_at    TO "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN used_at       TO "usedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN expires_at    TO "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN new_device_id TO "newDeviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN otp_hash      TO "otpHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE device_reset_otps RENAME COLUMN member_id     TO "memberId"`,
    );

    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN created_at TO "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN used_at    TO "usedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN expires_at TO "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN otp_hash   TO "otpHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE password_reset_otps RENAME COLUMN member_id  TO "memberId"`,
    );

    await queryRunner.query(
      `ALTER TABLE notes RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE notes RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE events RENAME COLUMN recurring_event_id TO "recurringEventId"`,
    );
    await queryRunner.query(
      `ALTER TABLE events RENAME COLUMN updated_at         TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE events RENAME COLUMN created_at         TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE admin_roles RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE admin_roles RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE departments RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE departments RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE venues RENAME COLUMN updated_at TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE venues RENAME COLUMN created_at TO "createdAt"`,
    );

    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN year_joined_church      TO "yearJoinedChurch"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN baptized_with_holy_ghost TO "baptizedWithHolyGhost"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN year_baptized           TO "yearBaptized"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN year_born_again         TO "yearBornAgain"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN marital_status          TO "maritalStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN date_of_birth           TO "dateOfBirth"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN device_id               TO "deviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN changed_password        TO "changedPassword"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN phone_number            TO "phoneNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN updated_at              TO "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE members RENAME COLUMN created_at              TO "createdAt"`,
    );
  }
}
