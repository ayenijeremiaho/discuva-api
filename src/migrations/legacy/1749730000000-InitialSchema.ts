import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Complete initial schema for Discovery Hub.
 * All enum columns use character varying — validation is enforced at the application layer.
 * Predefined admin roles are seeded at the end of up().
 */
export class InitialSchema1749730000000 implements MigrationInterface {
  name = 'InitialSchema1749730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Tables with no foreign-key dependencies ───────────────────────────

    await queryRunner.query(`
            CREATE TABLE "venues" (
                "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"       character varying        NOT NULL,
                "address"    character varying,
                "latitude"   double precision         NOT NULL,
                "longitude"  double precision         NOT NULL,
                CONSTRAINT "UQ_venues_name" UNIQUE ("name"),
                CONSTRAINT "PK_venues" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "departments" (
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"        character varying        NOT NULL,
                "description" character varying        NOT NULL,
                "key"         character varying,
                CONSTRAINT "UQ_departments_name" UNIQUE ("name"),
                CONSTRAINT "PK_departments" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "admin_roles" (
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"        character varying        NOT NULL,
                "description" character varying,
                "permissions" text[]                   NOT NULL DEFAULT '{}',
                CONSTRAINT "UQ_admin_roles_name" UNIQUE ("name"),
                CONSTRAINT "PK_admin_roles" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "members" (
                "createdAt"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "firstname"            character varying        NOT NULL,
                "lastname"             character varying        NOT NULL,
                "email"                character varying        NOT NULL,
                "phoneNumber"          character varying,
                "password"             character varying        NOT NULL,
                "changedPassword"      boolean                  NOT NULL DEFAULT false,
                "deviceId"             character varying,
                "role"                 character varying        NOT NULL DEFAULT 'MEMBER',
                "status"               character varying        NOT NULL DEFAULT 'ACTIVE',
                "gender"               character varying,
                "dateOfBirth"          date,
                "maritalStatus"        character varying,
                "yearBornAgain"        date,
                "yearBaptized"         date,
                "baptizedWithHolyGhost" boolean                 DEFAULT false,
                "yearJoinedChurch"     date,
                CONSTRAINT "UQ_members_email" UNIQUE ("email"),
                CONSTRAINT "PK_members" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_members_role"   ON "members" ("role")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_status" ON "members" ("status")`,
    );

    await queryRunner.query(`
            CREATE TABLE "events" (
                "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"             character varying        NOT NULL,
                "description"      character varying,
                "event_date"       date                     NOT NULL,
                "recurringEventId" character varying,
                CONSTRAINT "PK_events" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_events_event_date"       ON "events" ("event_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_recurringEventId" ON "events" ("recurringEventId")`,
    );

    await queryRunner.query(`
            CREATE TABLE "notes" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"        uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "type"      character varying        NOT NULL,
                "details"   json                     NOT NULL,
                CONSTRAINT "PK_notes" PRIMARY KEY ("id")
            )
        `);

    // OTP tables use a plain varchar memberId (not a FK) so they survive member deletes
    await queryRunner.query(`
            CREATE TABLE "password_reset_otps" (
                "id"       uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "memberId" character varying        NOT NULL,
                "otpHash"  character varying        NOT NULL,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "usedAt"   TIMESTAMP WITH TIME ZONE,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_password_reset_otps" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_otps_memberId" ON "password_reset_otps" ("memberId")`,
    );

    await queryRunner.query(`
            CREATE TABLE "device_reset_otps" (
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "memberId"    character varying        NOT NULL,
                "otpHash"     character varying        NOT NULL,
                "newDeviceId" character varying        NOT NULL,
                "expiresAt"   TIMESTAMP WITH TIME ZONE NOT NULL,
                "usedAt"      TIMESTAMP WITH TIME ZONE,
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_device_reset_otps" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_device_reset_otps_memberId" ON "device_reset_otps" ("memberId")`,
    );

    await queryRunner.query(`
            CREATE TABLE "child_age_groups" (
                "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"         character varying        NOT NULL,
                "minAgeMonths" integer                  NOT NULL,
                "maxAgeMonths" integer                  NOT NULL,
                "displayOrder" integer                  NOT NULL DEFAULT 0,
                CONSTRAINT "PK_child_age_groups" PRIMARY KEY ("id")
            )
        `);

    // ── Tables that depend on members / admin_roles ───────────────────────

    await queryRunner.query(`
            CREATE TABLE "admins" (
                "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "isActive"      boolean                  NOT NULL DEFAULT true,
                "member_id"     uuid,
                "admin_role_id" uuid,
                CONSTRAINT "UQ_admins_member_id" UNIQUE ("member_id"),
                CONSTRAINT "PK_admins" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_admins_member_id"     ON "admins" ("member_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admins_admin_role_id" ON "admins" ("admin_role_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD CONSTRAINT "FK_admins_member_id"     FOREIGN KEY ("member_id")     REFERENCES "members"("id")     ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD CONSTRAINT "FK_admins_admin_role_id" FOREIGN KEY ("admin_role_id") REFERENCES "admin_roles"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
            CREATE TABLE "member_sessions" (
                "createdAt"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "lastLogin"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "lastLogout"         TIMESTAMP WITH TIME ZONE,
                "hashedRefreshToken" text,
                "member_id"          uuid,
                CONSTRAINT "PK_member_sessions" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_member_sessions_member_id" ON "member_sessions" ("member_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_sessions_lastLogin"  ON "member_sessions" ("lastLogin")`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_sessions" ADD CONSTRAINT "FK_member_sessions_member_id" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
            CREATE TABLE "audit_logs" (
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "action"      character varying        NOT NULL,
                "actorId"     uuid,
                "targetId"    character varying,
                "targetEmail" character varying,
                "metadata"    jsonb,
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action"    ON "audit_logs" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actorId"   ON "audit_logs" ("actorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_targetId"  ON "audit_logs" ("targetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_logs_actorId" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "birthday_wishes" (
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "message"     text                     NOT NULL,
                "year"        smallint                 NOT NULL,
                "recipientId" uuid,
                "senderId"    uuid,
                CONSTRAINT "UQ_birthday_wishes_recipient_sender_year" UNIQUE ("recipientId", "senderId", "year"),
                CONSTRAINT "PK_birthday_wishes" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_birthday_wishes_recipientId" ON "birthday_wishes" ("recipientId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_birthday_wishes_year"        ON "birthday_wishes" ("year")`,
    );
    await queryRunner.query(
      `ALTER TABLE "birthday_wishes" ADD CONSTRAINT "FK_birthday_wishes_recipientId" FOREIGN KEY ("recipientId") REFERENCES "members"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "birthday_wishes" ADD CONSTRAINT "FK_birthday_wishes_senderId"    FOREIGN KEY ("senderId")    REFERENCES "members"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "sunday_school_classes" (
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"        character varying        NOT NULL,
                "description" text,
                "teacher_id"  uuid,
                CONSTRAINT "PK_sunday_school_classes" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `ALTER TABLE "sunday_school_classes" ADD CONSTRAINT "FK_sunday_school_classes_teacher_id" FOREIGN KEY ("teacher_id") REFERENCES "members"("id") ON DELETE SET NULL`,
    );

    // ── Tables that depend on departments / worker_profiles ───────────────

    await queryRunner.query(`
            CREATE TABLE "worker_profiles" (
                "createdAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "status"                 character varying        NOT NULL DEFAULT 'ACTIVE',
                "profession"             character varying,
                "yearJoinedWorkforce"    date,
                "completedSOD"           boolean                  NOT NULL DEFAULT false,
                "completedBibleCollege"  boolean                  NOT NULL DEFAULT false,
                "member_id"              uuid,
                "department_id"          uuid,
                "secondary_department_id" uuid,
                CONSTRAINT "UQ_worker_profiles_member_id" UNIQUE ("member_id"),
                CONSTRAINT "PK_worker_profiles" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_department_id"          ON "worker_profiles" ("department_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_secondary_department_id" ON "worker_profiles" ("secondary_department_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_status"                 ON "worker_profiles" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "worker_profiles" ADD CONSTRAINT "FK_worker_profiles_member_id"              FOREIGN KEY ("member_id")              REFERENCES "members"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "worker_profiles" ADD CONSTRAINT "FK_worker_profiles_department_id"          FOREIGN KEY ("department_id")          REFERENCES "departments"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "worker_profiles" ADD CONSTRAINT "FK_worker_profiles_secondary_department_id" FOREIGN KEY ("secondary_department_id") REFERENCES "departments"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "department_leads" (
                "createdAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "leadType"          character varying        NOT NULL,
                "worker_profile_id" uuid,
                "department_id"     uuid,
                CONSTRAINT "UQ_department_leads_dept_leadtype"       UNIQUE ("department_id", "leadType"),
                CONSTRAINT "UQ_department_leads_worker_profile_id"   UNIQUE ("worker_profile_id"),
                CONSTRAINT "PK_department_leads" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_department_leads_worker_profile_id" ON "department_leads" ("worker_profile_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "department_leads" ADD CONSTRAINT "FK_department_leads_worker_profile_id" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "department_leads" ADD CONSTRAINT "FK_department_leads_department_id"     FOREIGN KEY ("department_id")     REFERENCES "departments"("id")`,
    );

    await queryRunner.query(`
            CREATE TABLE "request_leave" (
                "createdAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "dateFrom"          TIMESTAMP WITH TIME ZONE NOT NULL,
                "dateTo"            TIMESTAMP WITH TIME ZONE NOT NULL,
                "reason"            character varying(500)   NOT NULL,
                "status"            character varying        NOT NULL DEFAULT 'PENDING',
                "worker_profile_id" uuid,
                "actioned_by"       uuid,
                CONSTRAINT "PK_request_leave" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_worker_profile_id" ON "request_leave" ("worker_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_dateFrom"          ON "request_leave" ("dateFrom")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_dateTo"            ON "request_leave" ("dateTo")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_status"            ON "request_leave" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_leave" ADD CONSTRAINT "FK_request_leave_worker_profile_id" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_leave" ADD CONSTRAINT "FK_request_leave_actioned_by"       FOREIGN KEY ("actioned_by")       REFERENCES "members"("id")         ON DELETE SET NULL`,
    );

    // ── Event / slot chain ────────────────────────────────────────────────

    await queryRunner.query(`
            CREATE TABLE "event_config" (
                "createdAt"                          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"                          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"                               character varying        NOT NULL,
                "description"                        character varying,
                "worker_checkin_start_offset_seconds" integer                 NOT NULL,
                "worker_late_offset_seconds"         integer                  NOT NULL,
                "member_checkin_start_offset_seconds" integer                 NOT NULL,
                "checkin_stop_offset_seconds"        integer                  NOT NULL,
                "allowed_distance_in_meters"         integer                  NOT NULL,
                "default_venue_id"                   uuid                     NOT NULL,
                CONSTRAINT "UQ_event_config_name" UNIQUE ("name"),
                CONSTRAINT "PK_event_config" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `ALTER TABLE "event_config" ADD CONSTRAINT "FK_event_config_default_venue_id" FOREIGN KEY ("default_venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
            CREATE TABLE "service_slots" (
                "createdAt"                    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"                    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                           uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"                         character varying        NOT NULL DEFAULT 'Service',
                "start_time"                   TIMESTAMP WITH TIME ZONE NOT NULL,
                "end_time"                     TIMESTAMP WITH TIME ZONE NOT NULL,
                "worker_checkin_start_override" integer,
                "worker_late_override"         integer,
                "member_checkin_start_override" integer,
                "checkin_stop_override"        integer,
                "allowed_distance_override"    integer,
                "markedAbsent"                 boolean                  NOT NULL DEFAULT false,
                "event_id"                     uuid,
                "config_id"                    uuid,
                "venue_override_id"            uuid,
                CONSTRAINT "PK_service_slots" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_event_id"     ON "service_slots" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_start_time"   ON "service_slots" ("start_time")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_end_time"     ON "service_slots" ("end_time")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_markedAbsent" ON "service_slots" ("markedAbsent")`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_slots" ADD CONSTRAINT "FK_service_slots_event_id"        FOREIGN KEY ("event_id")        REFERENCES "events"("id")      ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_slots" ADD CONSTRAINT "FK_service_slots_config_id"       FOREIGN KEY ("config_id")       REFERENCES "event_config"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_slots" ADD CONSTRAINT "FK_service_slots_venue_override_id" FOREIGN KEY ("venue_override_id") REFERENCES "venues"("id")  ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "event_reminders" (
                "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "audience"        character varying        NOT NULL DEFAULT 'ALL',
                "intervalPreset"  character varying        NOT NULL,
                "enabled"         boolean                  NOT NULL DEFAULT true,
                "last_sent_at"    TIMESTAMP WITH TIME ZONE,
                "service_slot_id" uuid,
                "department_id"   uuid,
                CONSTRAINT "UQ_event_reminders_slot_preset" UNIQUE ("service_slot_id", "intervalPreset"),
                CONSTRAINT "PK_event_reminders" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_event_reminders_service_slot_id" ON "event_reminders" ("service_slot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_reminders_last_sent_at"    ON "event_reminders" ("last_sent_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_reminders" ADD CONSTRAINT "FK_event_reminders_service_slot_id" FOREIGN KEY ("service_slot_id") REFERENCES "service_slots"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_reminders" ADD CONSTRAINT "FK_event_reminders_department_id"   FOREIGN KEY ("department_id")   REFERENCES "departments"("id")   ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "attendances" (
                "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "checkinTime"    TIMESTAMP WITH TIME ZONE,
                "status"         character varying        NOT NULL,
                "roleAtCheckin"  character varying        NOT NULL,
                "location"       jsonb,
                "member_id"      uuid,
                "service_slot_id" uuid,
                CONSTRAINT "UQ_attendances_member_slot" UNIQUE ("member_id", "service_slot_id"),
                CONSTRAINT "PK_attendances" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_member_id"           ON "attendances" ("member_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_service_slot_id"     ON "attendances" ("service_slot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_checkinTime"         ON "attendances" ("checkinTime")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_member_role_createdAt" ON "attendances" ("member_id", "roleAtCheckin", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendances" ADD CONSTRAINT "FK_attendances_member_id"       FOREIGN KEY ("member_id")       REFERENCES "members"("id")       ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendances" ADD CONSTRAINT "FK_attendances_service_slot_id" FOREIGN KEY ("service_slot_id") REFERENCES "service_slots"("id") ON DELETE CASCADE`,
    );

    // ── Classes, enrolments, announcements ───────────────────────────────

    await queryRunner.query(`
            CREATE TABLE "church_classes" (
                "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"         character varying        NOT NULL,
                "type"         character varying        NOT NULL,
                "description"  text,
                "startDate"    date,
                "endDate"      date,
                "facilitatorId" uuid,
                CONSTRAINT "PK_church_classes" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_church_classes_type" ON "church_classes" ("type")`,
    );
    await queryRunner.query(
      `ALTER TABLE "church_classes" ADD CONSTRAINT "FK_church_classes_facilitatorId" FOREIGN KEY ("facilitatorId") REFERENCES "members"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "class_enrollments" (
                "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "status"       character varying        NOT NULL DEFAULT 'IN_PROGRESS',
                "enrolledAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "completedAt"  TIMESTAMP WITH TIME ZONE,
                "cancelledAt"  TIMESTAMP WITH TIME ZONE,
                "memberId"     uuid,
                "churchClassId" uuid,
                CONSTRAINT "UQ_class_enrollments_member_class" UNIQUE ("memberId", "churchClassId"),
                CONSTRAINT "PK_class_enrollments" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_churchClassId"         ON "class_enrollments" ("churchClassId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_enrolledAt"            ON "class_enrollments" ("enrolledAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_status_completedAt"    ON "class_enrollments" ("status", "completedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_enrollments" ADD CONSTRAINT "FK_class_enrollments_memberId"     FOREIGN KEY ("memberId")     REFERENCES "members"("id")       ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_enrollments" ADD CONSTRAINT "FK_class_enrollments_churchClassId" FOREIGN KEY ("churchClassId") REFERENCES "church_classes"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
            CREATE TABLE "announcements" (
                "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "title"          character varying        NOT NULL,
                "body"           text                     NOT NULL,
                "audience"       character varying        NOT NULL DEFAULT 'ALL',
                "publishedAt"    TIMESTAMP WITH TIME ZONE,
                "expiresAt"      TIMESTAMP WITH TIME ZONE,
                "authorId"       uuid,
                "departmentId"   uuid,
                "targetMemberId" uuid,
                CONSTRAINT "PK_announcements" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_audience"       ON "announcements" ("audience")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_departmentId"   ON "announcements" ("departmentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_targetMemberId" ON "announcements" ("targetMemberId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_publishedAt"    ON "announcements" ("publishedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_expiresAt"      ON "announcements" ("expiresAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_announcements_authorId"       FOREIGN KEY ("authorId")       REFERENCES "members"("id")     ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_announcements_departmentId"   FOREIGN KEY ("departmentId")   REFERENCES "departments"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_announcements_targetMemberId" FOREIGN KEY ("targetMemberId") REFERENCES "members"("id")     ON DELETE SET NULL`,
    );

    // ── Sunday School ─────────────────────────────────────────────────────

    await queryRunner.query(`
            CREATE TABLE "sunday_school_members" (
                "createdAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "assignedAt"             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "member_id"              uuid,
                "sunday_school_class_id" uuid,
                CONSTRAINT "UQ_sunday_school_members_member_class" UNIQUE ("member_id", "sunday_school_class_id"),
                CONSTRAINT "PK_sunday_school_members" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_members_member_id"              ON "sunday_school_members" ("member_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_members_sunday_school_class_id" ON "sunday_school_members" ("sunday_school_class_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_members_assignedAt"             ON "sunday_school_members" ("assignedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sunday_school_members" ADD CONSTRAINT "FK_sunday_school_members_member_id"              FOREIGN KEY ("member_id")              REFERENCES "members"("id")             ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sunday_school_members" ADD CONSTRAINT "FK_sunday_school_members_sunday_school_class_id" FOREIGN KEY ("sunday_school_class_id") REFERENCES "sunday_school_classes"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
            CREATE TABLE "sunday_school_sessions" (
                "createdAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "sessionDate"            date                     NOT NULL,
                "selfMarkOpen"           boolean                  NOT NULL DEFAULT false,
                "notes"                  text,
                "sunday_school_class_id" uuid,
                CONSTRAINT "UQ_sunday_school_sessions_class_date" UNIQUE ("sunday_school_class_id", "sessionDate"),
                CONSTRAINT "PK_sunday_school_sessions" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_sessions_sunday_school_class_id" ON "sunday_school_sessions" ("sunday_school_class_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_sessions_sessionDate"             ON "sunday_school_sessions" ("sessionDate")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sunday_school_sessions" ADD CONSTRAINT "FK_sunday_school_sessions_sunday_school_class_id" FOREIGN KEY ("sunday_school_class_id") REFERENCES "sunday_school_classes"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
            CREATE TABLE "sunday_school_attendances" (
                "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "status"          character varying        NOT NULL,
                "markedByTeacher" boolean                  NOT NULL DEFAULT false,
                "markedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "session_id"      uuid,
                "member_id"       uuid,
                CONSTRAINT "UQ_sunday_school_attendances_session_member" UNIQUE ("session_id", "member_id"),
                CONSTRAINT "PK_sunday_school_attendances" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_attendances_session_id" ON "sunday_school_attendances" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_attendances_member_id"  ON "sunday_school_attendances" ("member_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_attendances_markedAt"   ON "sunday_school_attendances" ("markedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sunday_school_attendances" ADD CONSTRAINT "FK_sunday_school_attendances_session_id" FOREIGN KEY ("session_id") REFERENCES "sunday_school_sessions"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sunday_school_attendances" ADD CONSTRAINT "FK_sunday_school_attendances_member_id"  FOREIGN KEY ("member_id")  REFERENCES "members"("id")             ON DELETE CASCADE`,
    );

    // ── Children Church ───────────────────────────────────────────────────

    await queryRunner.query(`
            CREATE TABLE "child_class_groups" (
                "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "name"        character varying        NOT NULL,
                "capacity"    integer,
                "teacherNote" text,
                "age_group_id" uuid,
                CONSTRAINT "PK_child_class_groups" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_child_class_groups_age_group_id" ON "child_class_groups" ("age_group_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_class_groups" ADD CONSTRAINT "FK_child_class_groups_age_group_id" FOREIGN KEY ("age_group_id") REFERENCES "child_age_groups"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
            CREATE TABLE "child_profiles" (
                "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "firstname"        character varying        NOT NULL,
                "lastname"         character varying        NOT NULL,
                "dateOfBirth"      date                     NOT NULL,
                "photoUrl"         character varying,
                "specialNotes"     text,
                "age_group_id"     uuid,
                "class_group_id"   uuid,
                "registered_by_id" uuid,
                CONSTRAINT "PK_child_profiles" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_firstname"      ON "child_profiles" ("firstname")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_lastname"       ON "child_profiles" ("lastname")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_age_group_id"   ON "child_profiles" ("age_group_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_class_group_id" ON "child_profiles" ("class_group_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_profiles" ADD CONSTRAINT "FK_child_profiles_age_group_id"   FOREIGN KEY ("age_group_id")   REFERENCES "child_age_groups"("id")  ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_profiles" ADD CONSTRAINT "FK_child_profiles_class_group_id" FOREIGN KEY ("class_group_id") REFERENCES "child_class_groups"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_profiles" ADD CONSTRAINT "FK_child_profiles_registered_by_id" FOREIGN KEY ("registered_by_id") REFERENCES "members"("id")      ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "child_guardians" (
                "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "fullName"         character varying        NOT NULL,
                "phoneNumber"      character varying,
                "email"            character varying,
                "relationship"     character varying        NOT NULL,
                "photoUrl"         character varying,
                "isAuthorizedPickup" boolean               NOT NULL DEFAULT true,
                "child_id"         uuid,
                "member_id"        uuid,
                CONSTRAINT "PK_child_guardians" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_child_guardians_child_id" ON "child_guardians" ("child_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_guardians" ADD CONSTRAINT "FK_child_guardians_child_id"  FOREIGN KEY ("child_id")  REFERENCES "child_profiles"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_guardians" ADD CONSTRAINT "FK_child_guardians_member_id" FOREIGN KEY ("member_id") REFERENCES "members"("id")        ON DELETE SET NULL`,
    );

    await queryRunner.query(`
            CREATE TABLE "child_check_ins" (
                "createdAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "checkinTime"       TIMESTAMP WITH TIME ZONE NOT NULL,
                "checkoutTime"      TIMESTAMP WITH TIME ZONE,
                "pickupCode"        character varying        NOT NULL,
                "status"            character varying        NOT NULL DEFAULT 'CHECKED_IN',
                "droppedOffByName"  character varying,
                "pickedUpByName"    character varying,
                "flagReason"        text,
                "child_id"          uuid,
                "service_slot_id"   uuid,
                "dropped_off_by_id" uuid,
                "picked_up_by_id"   uuid,
                "checked_in_by_id"  uuid,
                CONSTRAINT "UQ_child_check_ins_pickupCode" UNIQUE ("pickupCode"),
                CONSTRAINT "PK_child_check_ins" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_child_id"        ON "child_check_ins" ("child_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_service_slot_id" ON "child_check_ins" ("service_slot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_status"          ON "child_check_ins" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_child_status"    ON "child_check_ins" ("child_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_check_ins" ADD CONSTRAINT "FK_child_check_ins_child_id"          FOREIGN KEY ("child_id")          REFERENCES "child_profiles"("id")  ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_check_ins" ADD CONSTRAINT "FK_child_check_ins_service_slot_id"   FOREIGN KEY ("service_slot_id")   REFERENCES "service_slots"("id")   ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_check_ins" ADD CONSTRAINT "FK_child_check_ins_dropped_off_by_id" FOREIGN KEY ("dropped_off_by_id") REFERENCES "child_guardians"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_check_ins" ADD CONSTRAINT "FK_child_check_ins_picked_up_by_id"   FOREIGN KEY ("picked_up_by_id")   REFERENCES "child_guardians"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "child_check_ins" ADD CONSTRAINT "FK_child_check_ins_checked_in_by_id"  FOREIGN KEY ("checked_in_by_id")  REFERENCES "members"("id")         ON DELETE SET NULL`,
    );

    // ── Email delivery log ────────────────────────────────────────────────

    await queryRunner.query(`
            CREATE TABLE "email_logs" (
                "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
                "recipient"    character varying        NOT NULL,
                "subject"      character varying,
                "status"       character varying        NOT NULL,
                "jobId"        character varying,
                "errorMessage" text,
                "attemptsMade" integer                  NOT NULL DEFAULT 0,
                "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_email_logs" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_email_logs_recipient" ON "email_logs" ("recipient")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_logs_status"    ON "email_logs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_logs_createdAt" ON "email_logs" ("createdAt")`,
    );

    // ── Seed predefined admin roles ───────────────────────────────────────

    const roles: Array<{
      name: string;
      description: string;
      permissions: string;
    }> = [
      {
        name: 'Super Admin',
        description: 'Full access to all modules and administrative functions.',
        permissions:
          '{members:read,members:write,events:read,events:write,venues:read,venues:write,departments:read,departments:write,attendance:read,leave:read,leave:write,classes:read,classes:write,announcements:read,announcements:write,notes:read,notes:write,dashboard:read,sunday_school:read,sunday_school:write,children_church:read,children_church:write,admin:read,admin:write,audit:read}',
      },
      {
        name: 'General Admin',
        description:
          'Broad operational access. Cannot manage admin users or view audit logs.',
        permissions:
          '{members:read,members:write,events:read,events:write,venues:read,venues:write,departments:read,departments:write,attendance:read,leave:read,leave:write,classes:read,classes:write,announcements:read,announcements:write,notes:read,notes:write,dashboard:read,sunday_school:read,sunday_school:write,children_church:read,children_church:write,admin:read}',
      },
      {
        name: 'Member Coordinator',
        description:
          'Manages member records, worker promotions, department assignments, and attendance data.',
        permissions:
          '{members:read,members:write,departments:read,attendance:read,dashboard:read}',
      },
      {
        name: 'Content Manager',
        description:
          'Creates and manages announcements, events, and venue records.',
        permissions:
          '{announcements:read,announcements:write,events:read,events:write,venues:read,venues:write,dashboard:read}',
      },
      {
        name: 'Welfare & Pastoral',
        description:
          'Handles pastoral notes, leave approvals, and general member welfare.',
        permissions:
          '{notes:read,notes:write,members:read,leave:read,leave:write,departments:read,dashboard:read}',
      },
      {
        name: 'Children Church Coordinator',
        description:
          "Manages the Children's Church module — age groups, class groups, child profiles, and check-ins.",
        permissions:
          '{children_church:read,children_church:write,members:read,attendance:read,dashboard:read}',
      },
      {
        name: 'Sunday School Coordinator',
        description:
          'Manages Sunday School classes, sessions, and member attendance.',
        permissions:
          '{sunday_school:read,sunday_school:write,members:read,attendance:read,dashboard:read}',
      },
      {
        name: 'Attendance Monitor',
        description:
          'Read-only view of attendance records, event schedules, and the dashboard.',
        permissions:
          '{attendance:read,events:read,venues:read,members:read,departments:read,dashboard:read}',
      },
      {
        name: 'Leave Approver',
        description: 'Reviews and approves or rejects worker leave requests.',
        permissions: '{leave:read,leave:write,members:read,departments:read}',
      },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO "admin_roles" ("name", "description", "permissions") VALUES ($1, $2, $3) ON CONFLICT ("name") DO NOTHING`,
        [role.name, role.description, role.permissions],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS "email_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "child_check_ins"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "child_guardians"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "child_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "child_class_groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "child_age_groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sunday_school_attendances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sunday_school_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sunday_school_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sunday_school_classes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "birthday_wishes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "announcements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "class_enrollments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "church_classes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attendances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_reminders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_slots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_config"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "request_leave"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "department_leads"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "worker_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "member_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admins"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "device_reset_otps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "password_reset_otps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "departments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "venues"`);
  }
}
