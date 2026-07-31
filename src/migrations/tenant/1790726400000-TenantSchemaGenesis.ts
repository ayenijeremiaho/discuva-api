import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema-agnostic twin of src/migrations/1790553600000-Baseline.ts, for
 * provisioning new tenant schemas (docs/MULTI_TENANT_MIGRATION.md §4.8).
 *
 * Baseline was generated via `pg_dump --schema-only`, which hardcodes every
 * object name as `public.foo` — fine for the single default deployment it
 * was built for, but it means Baseline can never create tables in any other
 * schema: the raw SQL always targets `public` regardless of the running
 * DataSource's `schema` option, and immediately fails with "already exists"
 * against a fresh tenant schema (confirmed empirically, not theoretical).
 * This file is that same SQL with every `public.` qualifier stripped, so
 * unqualified identifiers resolve via whatever schema is active on the
 * connection — exactly what TenantProvisioningService needs.
 *
 * Lives in src/migrations/tenant/ (not src/migrations/) specifically so the
 * main app's own migration runner (glob: src/migrations/*, non-recursive)
 * never picks it up — this migration is applied ONLY by
 * TenantProvisioningService/migrate-all-tenants.ts, never by
 * `npm run migration:run`.
 *
 * Content-wise this is exactly Baseline: no platform control-plane tables
 * (tenants/plans/subscriptions/etc.) — those were added by a later
 * migration and correctly belong only in `public`, never replicated per
 * tenant.
 *
 * MAINTENANCE COST (accepted, see the multi-tenant migration doc): any
 * future migration that changes tenant-owned business tables needs a
 * counterpart added to src/migrations/tenant/ too, until Phase 8's
 * existing-client migration retires src/migrations/'s business-schema
 * role entirely and this becomes the only copy that matters.
 */
export class TenantSchemaGenesis1790726400000 implements MigrationInterface {
  name = 'TenantSchemaGenesis1790726400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;`,
    );
    await queryRunner.query(`CREATE TABLE admin_roles (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying,
    permissions text[] DEFAULT '{}'::text[] NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE admins (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    member_id uuid,
    admin_role_id uuid
);`);
    await queryRunner.query(`CREATE TABLE announcement_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    announcement_id uuid NOT NULL,
    member_id uuid NOT NULL,
    emoji character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE announcements (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying NOT NULL,
    body text NOT NULL,
    audience character varying DEFAULT 'ALL'::character varying NOT NULL,
    published_at timestamp with time zone,
    expires_at timestamp with time zone,
    author_id uuid,
    department_id uuid,
    target_member_id uuid,
    group_id uuid,
    send_via_sms boolean DEFAULT false NOT NULL,
    sms_body text
);`);
    await queryRunner.query(`CREATE TABLE asset_checkout_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkout_id uuid NOT NULL,
    type character varying NOT NULL,
    days_overdue integer,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE asset_checkouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    checked_out_to_member_id uuid,
    checked_out_to_department_id uuid,
    checked_out_at timestamp with time zone NOT NULL,
    expected_return_at timestamp with time zone,
    returned_at timestamp with time zone,
    purpose character varying,
    notes text,
    checked_out_by_admin_id uuid NOT NULL,
    returned_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE asset_maintenance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    type character varying NOT NULL,
    performed_at date NOT NULL,
    performed_by character varying NOT NULL,
    cost numeric(15,2),
    notes text NOT NULL,
    attachments text,
    condition_after character varying NOT NULL,
    completion_status character varying NOT NULL,
    logged_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE asset_maintenance_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    frequency_unit character varying NOT NULL,
    frequency_value integer NOT NULL,
    last_maintained_at date,
    next_due_at date NOT NULL,
    notified_7_days_at timestamp with time zone,
    notified_3_days_at timestamp with time zone,
    notified_1_day_at timestamp with time zone,
    notified_due_day_at timestamp with time zone,
    last_overdue_notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_number character varying NOT NULL,
    name character varying NOT NULL,
    description text,
    category character varying NOT NULL,
    location character varying,
    status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
    purchase_date date,
    purchase_value numeric(15,2),
    maintenance_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    inventory_enabled boolean DEFAULT false NOT NULL,
    serial_number character varying,
    manufacturer character varying,
    model character varying,
    warranty_expiry date,
    vendor_name character varying,
    vendor_contact character varying,
    department_id uuid,
    in_storage integer,
    in_use integer,
    under_repair integer,
    written_off integer,
    warranty_notified_30_days_at timestamp with time zone,
    warranty_notified_14_days_at timestamp with time zone,
    warranty_notified_7_days_at timestamp with time zone,
    warranty_notified_1_day_at timestamp with time zone,
    insurance_expiry date,
    roadworthiness_expiry date,
    insurance_notified_30_days_at timestamp with time zone,
    insurance_notified_14_days_at timestamp with time zone,
    insurance_notified_7_days_at timestamp with time zone,
    insurance_notified_1_day_at timestamp with time zone,
    roadworthiness_notified_30_days_at timestamp with time zone,
    roadworthiness_notified_14_days_at timestamp with time zone,
    roadworthiness_notified_7_days_at timestamp with time zone,
    roadworthiness_notified_1_day_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE attendances (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkin_time timestamp with time zone,
    status character varying NOT NULL,
    role_at_checkin character varying NOT NULL,
    location jsonb,
    member_id uuid,
    service_slot_id uuid,
    event_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action character varying NOT NULL,
    actor_id uuid,
    target_id character varying,
    target_email character varying,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_name character varying
);`);
    await queryRunner.query(`CREATE TABLE birthday_wishes (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message text NOT NULL,
    year smallint NOT NULL,
    recipient_id uuid,
    sender_id uuid
);`);
    await queryRunner.query(`CREATE TABLE child_age_groups (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    min_age_months integer NOT NULL,
    max_age_months integer NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE child_check_ins (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkin_time timestamp with time zone NOT NULL,
    checkout_time timestamp with time zone,
    pickup_code character varying NOT NULL,
    status character varying DEFAULT 'CHECKED_IN'::character varying NOT NULL,
    dropped_off_by_name character varying,
    picked_up_by_name character varying,
    flag_reason text,
    child_id uuid,
    service_slot_id uuid,
    dropped_off_by_id uuid,
    picked_up_by_id uuid,
    checked_in_by_id uuid
);`);
    await queryRunner.query(`CREATE TABLE child_class_groups (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    capacity integer,
    teacher_note text,
    age_group_id uuid
);`);
    await queryRunner.query(`CREATE TABLE child_guardians (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name character varying NOT NULL,
    phone_number character varying,
    email character varying,
    relationship character varying NOT NULL,
    photo_url character varying,
    is_authorized_pickup boolean DEFAULT true NOT NULL,
    child_id uuid,
    member_id uuid
);`);
    await queryRunner.query(`CREATE TABLE child_profiles (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    firstname character varying NOT NULL,
    lastname character varying NOT NULL,
    date_of_birth date NOT NULL,
    photo_url character varying,
    special_notes text,
    age_group_id uuid,
    class_group_id uuid,
    registered_by_id uuid
);`);
    await queryRunner.query(`CREATE TABLE church_classes (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    start_date date,
    end_date date,
    facilitator_id uuid,
    status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
    class_type_id uuid NOT NULL,
    document_url character varying
);`);
    await queryRunner.query(`CREATE TABLE church_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying NOT NULL,
    module_name character varying NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE class_enrollments (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying DEFAULT 'IN_PROGRESS'::character varying NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    member_id uuid,
    church_class_id uuid,
    certificate_issued boolean DEFAULT false NOT NULL,
    certificate_issued_at timestamp with time zone,
    certificate_number character varying
);`);
    await queryRunner.query(`CREATE TABLE class_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    next_class_type_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE convert_follow_up_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    convert_id uuid NOT NULL,
    logged_by uuid,
    logged_by_name character varying NOT NULL,
    note text,
    contacted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE converts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    phone character varying,
    notes text,
    status character varying DEFAULT 'UNSAVED'::character varying NOT NULL,
    onboarded_by uuid,
    onboarded_by_name character varying NOT NULL,
    assigned_to uuid,
    member_id uuid,
    linked_at timestamp with time zone,
    last_contacted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE department_leads (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_type character varying NOT NULL,
    worker_profile_id uuid,
    department_id uuid
);`);
    await queryRunner.query(`CREATE TABLE departments (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying NOT NULL,
    capabilities text[] DEFAULT '{}'::text[] NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE device_reset_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id character varying NOT NULL,
    otp_hash character varying NOT NULL,
    new_device_id character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE email_change_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    otp_hash character varying NOT NULL,
    new_email character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE email_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient character varying NOT NULL,
    subject character varying,
    status character varying NOT NULL,
    job_id character varying,
    error_message text,
    attempts_made integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider character varying
);`);
    await queryRunner.query(`CREATE TABLE event_config (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying,
    worker_checkin_start_offset_seconds integer NOT NULL,
    worker_late_offset_seconds integer NOT NULL,
    member_checkin_start_offset_seconds integer NOT NULL,
    checkin_stop_offset_seconds integer NOT NULL,
    allowed_distance_in_meters integer NOT NULL,
    default_venue_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE event_reminders (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audience character varying DEFAULT 'ALL'::character varying NOT NULL,
    interval_preset character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_sent_at timestamp with time zone,
    service_slot_id uuid,
    department_id uuid,
    fire_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE events (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying,
    event_date date NOT NULL,
    recurring_event_id character varying,
    end_date date NOT NULL,
    attendance_marked boolean DEFAULT false NOT NULL,
    online_attendance_enabled boolean DEFAULT false NOT NULL,
    online_notification_sent_at timestamp with time zone,
    thank_you_sent_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE finance_accounting_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    status character varying DEFAULT 'OPEN'::character varying NOT NULL,
    closed_at timestamp with time zone,
    closed_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    type character varying NOT NULL,
    subtype character varying NOT NULL,
    normal_balance character varying NOT NULL,
    fund_id uuid,
    current_balance numeric(15,2) DEFAULT 0 NOT NULL,
    low_balance_alert_threshold numeric(15,2),
    description text,
    bank_name character varying,
    account_number character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code character varying,
    CONSTRAINT chk_account_balance_non_negative CHECK ((current_balance >= '-0.01'::numeric))
);`);
    await queryRunner.query(`CREATE TABLE finance_bank_import_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    delimiter character varying DEFAULT ','::character varying NOT NULL,
    skip_header_rows integer DEFAULT 1 NOT NULL,
    date_column_index integer NOT NULL,
    date_format character varying NOT NULL,
    date_column_name character varying,
    narration_column_index integer NOT NULL,
    narration_column_name character varying,
    amount_convention character varying NOT NULL,
    amount_column_index integer,
    amount_column_name character varying,
    type_column_index integer,
    type_column_name character varying,
    debit_indicator character varying,
    credit_indicator character varying,
    debit_column_index integer,
    debit_column_name character varying,
    credit_column_index integer,
    credit_column_name character varying,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    fund_id uuid NOT NULL,
    account_id uuid NOT NULL,
    period character varying NOT NULL,
    amount numeric(15,2) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    alert_80_sent_at timestamp with time zone,
    alert_100_sent_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE finance_bulk_upload_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_type character varying NOT NULL,
    file_hash character varying NOT NULL,
    original_filename character varying NOT NULL,
    status character varying DEFAULT 'QUEUED'::character varying NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    processed_rows integer DEFAULT 0 NOT NULL,
    error_message text,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_id uuid
);`);
    await queryRunner.query(`CREATE TABLE finance_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_external_payees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    type character varying NOT NULL,
    contact_email character varying,
    contact_phone character varying,
    account_number character varying,
    bank_name character varying,
    registration_number character varying,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_funds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    type character varying NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    description text NOT NULL,
    reference character varying,
    source character varying NOT NULL,
    entry_type character varying NOT NULL,
    status character varying DEFAULT 'DRAFT'::character varying NOT NULL,
    idempotency_key character varying NOT NULL,
    accounting_period_id uuid NOT NULL,
    reversal_of_id uuid,
    created_by_id uuid NOT NULL,
    approved_by_id uuid,
    original_currency character varying,
    exchange_rate numeric(15,6),
    original_amount numeric(15,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_journal_entry_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal_entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    entry_type character varying NOT NULL,
    amount numeric(15,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_journal_entry_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal_entry_id uuid NOT NULL,
    link_type character varying NOT NULL,
    role character varying NOT NULL,
    member_id uuid,
    department_id uuid,
    service_event_id uuid,
    external_payee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_offerings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_event_id uuid,
    fund_id uuid NOT NULL,
    type character varying NOT NULL,
    cash_amount numeric(15,2) DEFAULT 0 NOT NULL,
    expected_transfer_amount numeric(15,2) DEFAULT 0 NOT NULL,
    is_reconciled boolean DEFAULT false NOT NULL,
    reconciled_at timestamp with time zone,
    notes text,
    recorded_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reconciled_by_id uuid
);`);
    await queryRunner.query(`CREATE TABLE finance_petty_cash_replenishments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_account_id uuid NOT NULL,
    to_cash_account_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    notes text,
    requested_by_id uuid NOT NULL,
    approved_by_id uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_pledge_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    fund_id uuid NOT NULL,
    target_amount numeric(15,2) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_pledge_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pledge_id uuid NOT NULL,
    submitted_by_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    payment_date date NOT NULL,
    reference character varying,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    finance_note character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_pledges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    total_amount numeric(15,2) NOT NULL,
    frequency character varying NOT NULL,
    start_date date NOT NULL,
    status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    guest_name character varying
);`);
    await queryRunner.query(`CREATE TABLE finance_reconciliation_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    row_fingerprint character varying NOT NULL,
    transaction_fingerprint character varying NOT NULL,
    transaction_date date NOT NULL,
    narration text NOT NULL,
    amount numeric(15,2) NOT NULL,
    credit_debit character varying NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    suggested_account_id uuid,
    confirmed_account_id uuid,
    match_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_recurring_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    description text NOT NULL,
    debit_account_id uuid NOT NULL,
    credit_account_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    frequency character varying NOT NULL,
    fund_id uuid NOT NULL,
    next_due_at timestamp with time zone NOT NULL,
    last_generated_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE finance_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requested_by uuid NOT NULL,
    department_id uuid NOT NULL,
    category_id uuid NOT NULL,
    reason text NOT NULL,
    amount numeric(12,2) NOT NULL,
    recipient_bank_name character varying NOT NULL,
    recipient_account_number character varying NOT NULL,
    recipient_account_name character varying NOT NULL,
    attachment_url character varying,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    proof_url character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attachment_public_id character varying,
    attachment_resource_type character varying,
    proof_public_id character varying,
    proof_resource_type character varying
);`);
    await queryRunner.query(`CREATE TABLE first_timer_visits (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    first_timer_id uuid NOT NULL,
    event_id uuid,
    visited_at date NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE first_timers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    firstname character varying NOT NULL,
    lastname character varying NOT NULL,
    phone character varying NOT NULL,
    email character varying,
    source character varying DEFAULT 'WALK_IN'::character varying NOT NULL,
    wants_to_join_church boolean DEFAULT false NOT NULL,
    enjoyed_about_church text,
    wants_to_join_workforce boolean DEFAULT false NOT NULL,
    notes text,
    visited_event_id uuid,
    created_by_member_id uuid,
    created_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    converted_member_id uuid,
    converted_at timestamp with time zone,
    invite_sent_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE follow_up_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    added_by_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_method character varying
);`);
    await queryRunner.query(`CREATE TABLE follow_up_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying DEFAULT 'FIRST_TIMER'::character varying NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    first_timer_id uuid,
    member_id uuid,
    event_id uuid,
    assigned_to_id uuid NOT NULL,
    outcome character varying,
    outcome_notes text,
    due_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE game_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    member_id uuid NOT NULL,
    total_score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE game_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    "order" integer NOT NULL,
    question_text text NOT NULL,
    options jsonb NOT NULL,
    correct_option_index integer NOT NULL,
    points integer DEFAULT 1000 NOT NULL,
    time_limit_seconds integer DEFAULT 20 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE game_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    question_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    selected_option_index integer NOT NULL,
    is_correct boolean NOT NULL,
    points_awarded integer NOT NULL,
    answered_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE game_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    session_code character varying NOT NULL,
    status character varying DEFAULT 'SCHEDULED'::character varying NOT NULL,
    host_admin_id uuid,
    current_question_index integer,
    current_question_started_at timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying NOT NULL,
    description text,
    status character varying DEFAULT 'DRAFT'::character varying NOT NULL,
    created_by_id uuid,
    department_id uuid,
    church_class_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE group_members (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    member_id uuid,
    added_by_id uuid,
    phone_number character varying,
    label character varying,
    CONSTRAINT "CHK_group_members_member_xor_phone" CHECK ((((member_id IS NOT NULL) AND (phone_number IS NULL)) OR ((member_id IS NULL) AND (phone_number IS NOT NULL))))
);`);
    await queryRunner.query(`CREATE TABLE groups (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    created_by_id uuid
);`);
    await queryRunner.query(`CREATE TABLE incident_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying NOT NULL,
    description text NOT NULL,
    images text,
    location character varying,
    status character varying DEFAULT 'OPEN'::character varying NOT NULL,
    is_anonymous boolean DEFAULT false NOT NULL,
    admin_notes text,
    resolved_at timestamp with time zone,
    reporter_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE member_import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_filename character varying NOT NULL,
    status character varying DEFAULT 'READY_FOR_REVIEW'::character varying NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    valid_rows integer DEFAULT 0 NOT NULL,
    created_count integer DEFAULT 0 NOT NULL,
    failed_commit_count integer DEFAULT 0 NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE member_import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    row_number integer NOT NULL,
    data jsonb NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    created_member_id uuid,
    commit_error character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE member_sessions (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    last_login timestamp with time zone DEFAULT now() NOT NULL,
    last_logout timestamp with time zone,
    hashed_refresh_token text,
    member_id uuid,
    surface character varying DEFAULT 'MEMBER'::character varying NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE member_virtual_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    provider character varying NOT NULL,
    bank_name character varying NOT NULL,
    account_number character varying NOT NULL,
    account_name character varying NOT NULL,
    provider_ref character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    deactivated_by_id uuid,
    deactivated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE members (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    firstname character varying NOT NULL,
    lastname character varying NOT NULL,
    email character varying NOT NULL,
    phone_number character varying,
    password character varying NOT NULL,
    changed_password boolean DEFAULT false NOT NULL,
    device_id character varying,
    role character varying DEFAULT 'MEMBER'::character varying NOT NULL,
    status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
    gender character varying,
    marital_status character varying,
    year_born_again date,
    year_baptized date,
    baptized_with_holy_ghost boolean DEFAULT false,
    date_joined_church date,
    birth_day smallint,
    birth_month smallint,
    birth_year smallint,
    birthday_greeted_year smallint,
    photo_url character varying,
    photo_public_id character varying,
    anniversary_greeted_year smallint
);`);
    await queryRunner.query(`CREATE TABLE notes (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying NOT NULL,
    details json NOT NULL,
    member_id uuid
);`);
    await queryRunner.query(`CREATE TABLE password_reset_otps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id character varying NOT NULL,
    otp_hash character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE pastor_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    submitted_by_id uuid,
    submitted_by_name character varying NOT NULL,
    week_of date NOT NULL,
    attendance_notes text NOT NULL,
    highlights text NOT NULL,
    challenges text NOT NULL,
    prayer_requests text,
    additional_notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_by_pastor_id uuid,
    responded_by_pastor_name character varying,
    pastor_response text,
    pastor_responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE pastors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    type character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_day_configs (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    day_of_week integer NOT NULL,
    mode character varying DEFAULT 'VIRTUAL'::character varying NOT NULL,
    start_time character varying DEFAULT '00:00'::character varying NOT NULL,
    end_time character varying DEFAULT '01:00'::character varying NOT NULL,
    max_capacity integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    program_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_fixed_assignments (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    worker_profile_id uuid NOT NULL,
    day_config_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_meetings (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    date date NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    day_config_id uuid NOT NULL,
    status character varying DEFAULT 'SCHEDULED'::character varying NOT NULL,
    selection_status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    current_capacity integer DEFAULT 0 NOT NULL,
    program_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    audience character varying DEFAULT 'WORKERS'::character varying NOT NULL,
    selection_window_days integer DEFAULT 7 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    submitted_by_name character varying NOT NULL,
    content text NOT NULL,
    status character varying DEFAULT 'OPEN'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_roster_entries (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    worker_profile_id uuid,
    meeting_id uuid NOT NULL,
    assignment_type character varying NOT NULL,
    status character varying DEFAULT 'SCHEDULED'::character varying NOT NULL,
    rescheduled_from_id uuid,
    reminder_two_day_sent boolean DEFAULT false NOT NULL,
    reminder_day_sent boolean DEFAULT false NOT NULL,
    member_id uuid
);`);
    await queryRunner.query(`CREATE TABLE prayer_schedule_configs (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    selection_window_days integer DEFAULT 7 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE prayer_schedule_rules (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    type character varying NOT NULL,
    target_lead_type character varying,
    value integer NOT NULL,
    description character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    program_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE pregnancy_prayer_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    name character varying NOT NULL,
    edd date NOT NULL,
    details text,
    status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
    last_prayed_at timestamp with time zone,
    created_by uuid,
    created_by_name character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE pregnancy_prayer_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    logged_by uuid,
    logged_by_name character varying NOT NULL,
    note text,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_addons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    price numeric(15,2) NOT NULL,
    caution_amount numeric(15,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    asset_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_booking_addons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    addon_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(15,2) NOT NULL,
    unit_caution numeric(15,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    member_id uuid NOT NULL,
    start_date_time timestamp with time zone NOT NULL,
    end_date_time timestamp with time zone NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    member_category character varying NOT NULL,
    base_price numeric(15,2) NOT NULL,
    discount_type character varying,
    discount_value numeric(10,2),
    discount_source character varying DEFAULT 'NONE'::character varying NOT NULL,
    service_fee numeric(15,2) NOT NULL,
    caution_total numeric(15,2) NOT NULL,
    grand_total numeric(15,2) NOT NULL,
    override_discount_type character varying,
    override_discount_value numeric(10,2),
    override_discount_note text,
    purpose text,
    notes text,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_calendar_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    start_date_time timestamp with time zone NOT NULL,
    end_date_time timestamp with time zone NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_facilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    base_price numeric(15,2) NOT NULL,
    capacity integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    type character varying NOT NULL,
    amount numeric(15,2) NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    paid_at timestamp with time zone,
    refunded_at timestamp with time zone,
    reference character varying,
    proof_url character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE rental_pricing_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_category character varying NOT NULL,
    discount_type character varying NOT NULL,
    discount_value numeric(10,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE request_leave (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date_from date NOT NULL,
    date_to date NOT NULL,
    reason character varying(500) NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    worker_profile_id uuid,
    actioned_by uuid
);`);
    await queryRunner.query(`CREATE TABLE sermon_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sermon_id uuid NOT NULL,
    member_id uuid NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE sermons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying NOT NULL,
    speaker_name character varying NOT NULL,
    date timestamp with time zone NOT NULL,
    description text,
    youtube_url character varying,
    mixlr_url character varying,
    series character varying,
    created_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_action_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    actor_role character varying NOT NULL,
    action character varying NOT NULL,
    detail character varying,
    performed_by_member_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_label character varying
);`);
    await queryRunner.query(`CREATE TABLE service_headcounts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    male_adults integer DEFAULT 0 NOT NULL,
    female_adults integer DEFAULT 0 NOT NULL,
    teenagers integer DEFAULT 0 NOT NULL,
    children integer DEFAULT 0 NOT NULL,
    mobile_church integer DEFAULT 0 NOT NULL,
    custom_groups jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    service_slot_id uuid NOT NULL,
    recorded_by_id uuid
);`);
    await queryRunner.query(`CREATE TABLE service_pause_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    slot_position integer NOT NULL,
    reason character varying NOT NULL,
    paused_at timestamp with time zone NOT NULL,
    resumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_programme_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    "position" integer NOT NULL,
    type character varying NOT NULL,
    topic character varying,
    member_id uuid,
    guest_name character varying,
    backup_member_id uuid,
    backup_guest_name character varying,
    allocated_minutes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reminder_sent_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE service_programme_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    service_slot_name character varying NOT NULL,
    slots jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_from_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_programmes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_slot_id uuid NOT NULL,
    status character varying DEFAULT 'DRAFT'::character varying NOT NULL,
    save_as_template boolean DEFAULT false NOT NULL,
    created_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    service_slot_id uuid NOT NULL,
    member_id uuid NOT NULL,
    rating smallint NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_session_access_grants (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    name character varying NOT NULL,
    pin_hash character varying NOT NULL,
    granted_by_member_id uuid,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone
);`);
    await queryRunner.query(`CREATE TABLE service_session_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    programme_slot_id uuid NOT NULL,
    "position" integer NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    adjusted_allocated_minutes integer,
    overridden_topic character varying,
    overridden_speaker_name character varying,
    overridden_member_id uuid,
    actual_seconds integer,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    session_code character varying NOT NULL,
    status character varying DEFAULT 'LIVE'::character varying NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE service_slots (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying DEFAULT 'Service'::character varying NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    worker_checkin_start_override integer,
    worker_late_override integer,
    member_checkin_start_override integer,
    checkin_stop_override integer,
    allowed_distance_override integer,
    event_id uuid,
    config_id uuid,
    venue_override_id uuid
);`);
    await queryRunner.query(`CREATE TABLE small_group_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    member_id uuid NOT NULL,
    meeting_date date NOT NULL,
    status character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE small_group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    member_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE small_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    leader_id uuid,
    meeting_day character varying,
    meeting_location character varying,
    created_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE sunday_school_attendances (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying NOT NULL,
    marked_by_teacher boolean DEFAULT false NOT NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid,
    member_id uuid
);`);
    await queryRunner.query(`CREATE TABLE sunday_school_classes (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    teacher_id uuid
);`);
    await queryRunner.query(`CREATE TABLE sunday_school_members (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    member_id uuid,
    sunday_school_class_id uuid
);`);
    await queryRunner.query(`CREATE TABLE sunday_school_sessions (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_date date NOT NULL,
    notes text,
    sunday_school_class_id uuid,
    self_mark_closes_at timestamp with time zone,
    document_url character varying
);`);
    await queryRunner.query(`CREATE TABLE testimonies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    submitted_by_name character varying NOT NULL,
    prayer_request_id uuid,
    content text NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE tithe_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_name character varying NOT NULL,
    account_number character varying NOT NULL,
    account_name character varying NOT NULL,
    currency character varying NOT NULL,
    description character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE tithe_dispute_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    existing_record_id uuid NOT NULL,
    member_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    reference character varying,
    bank_name character varying,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE tithe_payment_proofs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    member_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    reference character varying,
    proof_url character varying NOT NULL,
    public_id character varying NOT NULL,
    resource_type character varying NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    finance_note character varying,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tithe_account_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE tithe_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    batch_id uuid,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    reference character varying,
    bank_name character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying DEFAULT 'MANUAL_PROOF'::character varying,
    external_reference character varying,
    payment_channel character varying,
    virtual_account_id uuid
);`);
    await queryRunner.query(`CREATE TABLE tithe_unmatched_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    raw_email character varying NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    reference character varying,
    bank_name character varying,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    matched_member_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE tithe_upload_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    uploaded_by uuid NOT NULL,
    file_name character varying NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    matched_rows integer DEFAULT 0 NOT NULL,
    unmatched_rows integer DEFAULT 0 NOT NULL,
    disputed_rows integer DEFAULT 0 NOT NULL,
    error_message character varying,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rows jsonb,
    tithe_account_id uuid NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE venues (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    address character varying,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE volunteer_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying NOT NULL,
    description text,
    department_id uuid,
    date timestamp with time zone NOT NULL,
    capacity integer,
    confirmed_count integer DEFAULT 0 NOT NULL,
    status character varying DEFAULT 'OPEN'::character varying NOT NULL,
    created_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE volunteer_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid NOT NULL,
    member_id uuid NOT NULL,
    status character varying DEFAULT 'CONFIRMED'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE worker_profiles (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
    profession character varying,
    year_joined_workforce date,
    completed_sod boolean DEFAULT false NOT NULL,
    completed_bible_college boolean DEFAULT false NOT NULL,
    member_id uuid,
    department_id uuid,
    secondary_department_id uuid,
    is_trainee boolean DEFAULT false NOT NULL
);`);
    await queryRunner.query(`CREATE TABLE youtube_integration_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id character varying NOT NULL,
    last_announced_video_id character varying,
    subscription_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);`);
    await queryRunner.query(`ALTER TABLE ONLY admin_roles
    ADD CONSTRAINT "PK_admin_roles" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY admins
    ADD CONSTRAINT "PK_admins" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY announcements
    ADD CONSTRAINT "PK_announcements" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY attendances
    ADD CONSTRAINT "PK_attendances" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT "PK_audit_logs" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY birthday_wishes
    ADD CONSTRAINT "PK_birthday_wishes" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY child_age_groups
    ADD CONSTRAINT "PK_child_age_groups" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "PK_child_check_ins" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY child_class_groups
    ADD CONSTRAINT "PK_child_class_groups" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY child_guardians
    ADD CONSTRAINT "PK_child_guardians" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY child_profiles
    ADD CONSTRAINT "PK_child_profiles" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY church_classes
    ADD CONSTRAINT "PK_church_classes" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY class_enrollments
    ADD CONSTRAINT "PK_class_enrollments" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY department_leads
    ADD CONSTRAINT "PK_department_leads" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY departments
    ADD CONSTRAINT "PK_departments" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY device_reset_otps
    ADD CONSTRAINT "PK_device_reset_otps" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY email_logs
    ADD CONSTRAINT "PK_email_logs" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY event_config
    ADD CONSTRAINT "PK_event_config" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY event_reminders
    ADD CONSTRAINT "PK_event_reminders" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY events
    ADD CONSTRAINT "PK_events" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY group_members
    ADD CONSTRAINT "PK_group_members" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY groups
    ADD CONSTRAINT "PK_groups" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY member_sessions
    ADD CONSTRAINT "PK_member_sessions" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY members
    ADD CONSTRAINT "PK_members" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY notes
    ADD CONSTRAINT "PK_notes" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY password_reset_otps
    ADD CONSTRAINT "PK_password_reset_otps" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_day_configs
    ADD CONSTRAINT "PK_prayer_day_configs" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_fixed_assignments
    ADD CONSTRAINT "PK_prayer_fixed_assignments" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_meetings
    ADD CONSTRAINT "PK_prayer_meetings" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_roster_entries
    ADD CONSTRAINT "PK_prayer_roster_entries" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_schedule_configs
    ADD CONSTRAINT "PK_prayer_schedule_configs" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_schedule_rules
    ADD CONSTRAINT "PK_prayer_schedule_rules" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT "PK_push_subscriptions" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_addons
    ADD CONSTRAINT "PK_rental_addons" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_booking_addons
    ADD CONSTRAINT "PK_rental_booking_addons" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_bookings
    ADD CONSTRAINT "PK_rental_bookings" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_calendar_blocks
    ADD CONSTRAINT "PK_rental_calendar_blocks" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_facilities
    ADD CONSTRAINT "PK_rental_facilities" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_payments
    ADD CONSTRAINT "PK_rental_payments" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_pricing_tiers
    ADD CONSTRAINT "PK_rental_pricing_tiers" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY request_leave
    ADD CONSTRAINT "PK_request_leave" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_access_grants
    ADD CONSTRAINT "PK_service_session_access_grants" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_slots
    ADD CONSTRAINT "PK_service_slots" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_attendances
    ADD CONSTRAINT "PK_sunday_school_attendances" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_classes
    ADD CONSTRAINT "PK_sunday_school_classes" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_members
    ADD CONSTRAINT "PK_sunday_school_members" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_sessions
    ADD CONSTRAINT "PK_sunday_school_sessions" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_payment_proofs
    ADD CONSTRAINT "PK_tithe_payment_proofs" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY venues
    ADD CONSTRAINT "PK_venues" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY worker_profiles
    ADD CONSTRAINT "PK_worker_profiles" PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY admin_roles
    ADD CONSTRAINT "UQ_admin_roles_name" UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY admins
    ADD CONSTRAINT "UQ_admins_member_id" UNIQUE (member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY announcement_reactions
    ADD CONSTRAINT "UQ_announcement_reactions_announcement_member" UNIQUE (announcement_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY attendances
    ADD CONSTRAINT "UQ_attendances_member_slot" UNIQUE (member_id, service_slot_id);`);
    await queryRunner.query(`ALTER TABLE ONLY birthday_wishes
    ADD CONSTRAINT "UQ_birthday_wishes_recipient_sender_year" UNIQUE (recipient_id, sender_id, year);`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "UQ_child_check_ins_pickupCode" UNIQUE (pickup_code);`);
    await queryRunner.query(`ALTER TABLE ONLY class_enrollments
    ADD CONSTRAINT "UQ_class_enrollments_member_class" UNIQUE (member_id, church_class_id);`);
    await queryRunner.query(`ALTER TABLE ONLY pastor_feedback
    ADD CONSTRAINT "UQ_department_feedback_department_week" UNIQUE (department_id, week_of);`);
    await queryRunner.query(`ALTER TABLE ONLY department_leads
    ADD CONSTRAINT "UQ_department_leads_dept_leadtype" UNIQUE (department_id, lead_type);`);
    await queryRunner.query(`ALTER TABLE ONLY department_leads
    ADD CONSTRAINT "UQ_department_leads_worker_profile_id" UNIQUE (worker_profile_id);`);
    await queryRunner.query(`ALTER TABLE ONLY departments
    ADD CONSTRAINT "UQ_departments_name" UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY event_config
    ADD CONSTRAINT "UQ_event_config_name" UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY event_reminders
    ADD CONSTRAINT "UQ_event_reminders_slot_preset" UNIQUE (service_slot_id, interval_preset);`);
    await queryRunner.query(`ALTER TABLE ONLY game_participants
    ADD CONSTRAINT "UQ_game_participants_session_member" UNIQUE (session_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY game_responses
    ADD CONSTRAINT "UQ_game_responses_session_question_participant" UNIQUE (session_id, question_id, participant_id);`);
    await queryRunner.query(`ALTER TABLE ONLY group_members
    ADD CONSTRAINT "UQ_group_members_group_id_member_id" UNIQUE (group_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY group_members
    ADD CONSTRAINT "UQ_group_members_group_id_phone_number" UNIQUE (group_id, phone_number);`);
    await queryRunner.query(`ALTER TABLE ONLY groups
    ADD CONSTRAINT "UQ_groups_name" UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY members
    ADD CONSTRAINT "UQ_members_email" UNIQUE (email);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_fixed_assignments
    ADD CONSTRAINT "UQ_prayer_fixed_assignment_worker_day" UNIQUE (worker_profile_id, day_config_id);`);
    await queryRunner.query(`ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT "UQ_push_subscriptions_member" UNIQUE (member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY rental_pricing_tiers
    ADD CONSTRAINT "UQ_rental_pricing_tiers_member_category" UNIQUE (member_category);`);
    await queryRunner.query(`ALTER TABLE ONLY sermon_notes
    ADD CONSTRAINT "UQ_sermon_notes_sermon_member" UNIQUE (sermon_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_ratings
    ADD CONSTRAINT "UQ_service_ratings_event_slot_member" UNIQUE (event_id, service_slot_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_attendance
    ADD CONSTRAINT "UQ_small_group_attendance_group_member_date" UNIQUE (group_id, member_id, meeting_date);`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_members
    ADD CONSTRAINT "UQ_small_group_members_group_member" UNIQUE (group_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_attendances
    ADD CONSTRAINT "UQ_sunday_school_attendances_session_member" UNIQUE (session_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_members
    ADD CONSTRAINT "UQ_sunday_school_members_member_class" UNIQUE (member_id, sunday_school_class_id);`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_sessions
    ADD CONSTRAINT "UQ_sunday_school_sessions_class_date" UNIQUE (sunday_school_class_id, session_date);`);
    await queryRunner.query(`ALTER TABLE ONLY venues
    ADD CONSTRAINT "UQ_venues_name" UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_signups
    ADD CONSTRAINT "UQ_volunteer_signups_opportunity_member" UNIQUE (opportunity_id, member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY worker_profiles
    ADD CONSTRAINT "UQ_worker_profiles_member_id" UNIQUE (member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY announcement_reactions
    ADD CONSTRAINT announcement_reactions_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkout_notifications
    ADD CONSTRAINT asset_checkout_notifications_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkouts
    ADD CONSTRAINT asset_checkouts_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY asset_maintenance_records
    ADD CONSTRAINT asset_maintenance_records_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY asset_maintenance_schedules
    ADD CONSTRAINT asset_maintenance_schedules_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY church_settings
    ADD CONSTRAINT church_settings_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY class_types
    ADD CONSTRAINT class_types_name_key UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY class_types
    ADD CONSTRAINT class_types_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY convert_follow_up_logs
    ADD CONSTRAINT convert_follow_up_logs_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY converts
    ADD CONSTRAINT converts_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY pastor_feedback
    ADD CONSTRAINT department_feedback_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY email_change_otps
    ADD CONSTRAINT email_change_otps_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_accounting_periods
    ADD CONSTRAINT finance_accounting_periods_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_accounts
    ADD CONSTRAINT finance_accounts_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_bank_import_profiles
    ADD CONSTRAINT finance_bank_import_profiles_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_budgets
    ADD CONSTRAINT finance_budgets_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_bulk_upload_jobs
    ADD CONSTRAINT finance_bulk_upload_jobs_file_hash_key UNIQUE (file_hash);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_bulk_upload_jobs
    ADD CONSTRAINT finance_bulk_upload_jobs_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_categories
    ADD CONSTRAINT finance_categories_name_key UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_categories
    ADD CONSTRAINT finance_categories_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_external_payees
    ADD CONSTRAINT finance_external_payees_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_funds
    ADD CONSTRAINT finance_funds_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_idempotency_key_key UNIQUE (idempotency_key);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_lines
    ADD CONSTRAINT finance_journal_entry_lines_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_links
    ADD CONSTRAINT finance_journal_entry_links_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_offerings
    ADD CONSTRAINT finance_offerings_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_petty_cash_replenishments
    ADD CONSTRAINT finance_petty_cash_replenishments_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_campaigns
    ADD CONSTRAINT finance_pledge_campaigns_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_contributions
    ADD CONSTRAINT finance_pledge_contributions_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledges
    ADD CONSTRAINT finance_pledges_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_reconciliation_rows
    ADD CONSTRAINT finance_reconciliation_rows_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_recurring_entries
    ADD CONSTRAINT finance_recurring_entries_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_requests
    ADD CONSTRAINT finance_requests_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY first_timer_visits
    ADD CONSTRAINT first_timer_visits_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY first_timers
    ADD CONSTRAINT first_timers_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_notes
    ADD CONSTRAINT follow_up_notes_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY game_participants
    ADD CONSTRAINT game_participants_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY game_questions
    ADD CONSTRAINT game_questions_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY game_responses
    ADD CONSTRAINT game_responses_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY game_sessions
    ADD CONSTRAINT game_sessions_session_code_key UNIQUE (session_code);`);
    await queryRunner.query(`ALTER TABLE ONLY games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY incident_reports
    ADD CONSTRAINT incident_reports_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY member_import_jobs
    ADD CONSTRAINT member_import_jobs_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY member_import_rows
    ADD CONSTRAINT member_import_rows_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY member_virtual_accounts
    ADD CONSTRAINT member_virtual_accounts_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY member_virtual_accounts
    ADD CONSTRAINT member_virtual_accounts_provider_ref_key UNIQUE (provider_ref);`);
    await queryRunner.query(`ALTER TABLE ONLY pastors
    ADD CONSTRAINT pastors_member_id_key UNIQUE (member_id);`);
    await queryRunner.query(`ALTER TABLE ONLY pastors
    ADD CONSTRAINT pastors_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_headcounts
    ADD CONSTRAINT pk_service_headcounts PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_programs
    ADD CONSTRAINT prayer_programs_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_requests
    ADD CONSTRAINT prayer_requests_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY pregnancy_prayer_cases
    ADD CONSTRAINT pregnancy_prayer_cases_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY pregnancy_prayer_visits
    ADD CONSTRAINT pregnancy_prayer_visits_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY sermon_notes
    ADD CONSTRAINT sermon_notes_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY sermons
    ADD CONSTRAINT sermons_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_action_entries
    ADD CONSTRAINT service_action_entries_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_pause_entries
    ADD CONSTRAINT service_pause_entries_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_programme_slots
    ADD CONSTRAINT service_programme_slots_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_programme_templates
    ADD CONSTRAINT service_programme_templates_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_programmes
    ADD CONSTRAINT service_programmes_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_programmes
    ADD CONSTRAINT service_programmes_service_slot_id_key UNIQUE (service_slot_id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_ratings
    ADD CONSTRAINT service_ratings_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_slots
    ADD CONSTRAINT service_session_slots_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_sessions
    ADD CONSTRAINT service_sessions_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_sessions
    ADD CONSTRAINT service_sessions_programme_id_key UNIQUE (programme_id);`);
    await queryRunner.query(`ALTER TABLE ONLY service_sessions
    ADD CONSTRAINT service_sessions_session_code_key UNIQUE (session_code);`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_attendance
    ADD CONSTRAINT small_group_attendance_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_members
    ADD CONSTRAINT small_group_members_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY small_groups
    ADD CONSTRAINT small_groups_name_key UNIQUE (name);`);
    await queryRunner.query(`ALTER TABLE ONLY small_groups
    ADD CONSTRAINT small_groups_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY testimonies
    ADD CONSTRAINT testimonies_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_accounts
    ADD CONSTRAINT tithe_accounts_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_dispute_records
    ADD CONSTRAINT tithe_dispute_records_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_records
    ADD CONSTRAINT tithe_records_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_unmatched_records
    ADD CONSTRAINT tithe_unmatched_records_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_upload_batches
    ADD CONSTRAINT tithe_upload_batches_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY finance_accounting_periods
    ADD CONSTRAINT uq_accounting_period UNIQUE (year, month);`);
    await queryRunner.query(`ALTER TABLE ONLY asset_maintenance_schedules
    ADD CONSTRAINT uq_asset_schedule_asset_id UNIQUE (asset_id);`);
    await queryRunner.query(`ALTER TABLE ONLY assets
    ADD CONSTRAINT uq_assets_tag_number UNIQUE (tag_number);`);
    await queryRunner.query(`ALTER TABLE ONLY church_settings
    ADD CONSTRAINT uq_church_settings_key UNIQUE (key);`);
    await queryRunner.query(`ALTER TABLE ONLY member_sessions
    ADD CONSTRAINT uq_member_sessions_member_surface UNIQUE (member_id, surface);`);
    await queryRunner.query(`ALTER TABLE ONLY service_headcounts
    ADD CONSTRAINT uq_service_headcounts_service_slot_id UNIQUE (service_slot_id);`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_opportunities
    ADD CONSTRAINT volunteer_opportunities_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_signups
    ADD CONSTRAINT volunteer_signups_pkey PRIMARY KEY (id);`);
    await queryRunner.query(`ALTER TABLE ONLY youtube_integration_state
    ADD CONSTRAINT youtube_integration_state_channel_id_key UNIQUE (channel_id);`);
    await queryRunner.query(`ALTER TABLE ONLY youtube_integration_state
    ADD CONSTRAINT youtube_integration_state_pkey PRIMARY KEY (id);`);
    await queryRunner.query(
      `CREATE INDEX "IDX_admins_admin_role_id" ON admins USING btree (admin_role_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admins_member_id" ON admins USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_reactions_announcement_id" ON announcement_reactions USING btree (announcement_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_audience" ON announcements USING btree (audience);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_departmentId" ON announcements USING btree (department_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_expiresAt" ON announcements USING btree (expires_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_publishedAt" ON announcements USING btree (published_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_targetMemberId" ON announcements USING btree (target_member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_checkouts_asset_id" ON asset_checkouts USING btree (asset_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_checkinTime" ON attendances USING btree (checkin_time);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_member_id" ON attendances USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_member_role_createdAt" ON attendances USING btree (member_id, role_at_checkin, created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendances_service_slot_id" ON attendances USING btree (service_slot_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action" ON audit_logs USING btree (action);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actorId" ON audit_logs USING btree (actor_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_createdAt" ON audit_logs USING btree (created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_targetId" ON audit_logs USING btree (target_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_birthday_wishes_recipientId" ON birthday_wishes USING btree (recipient_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_birthday_wishes_year" ON birthday_wishes USING btree (year);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_child_id" ON child_check_ins USING btree (child_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_child_status" ON child_check_ins USING btree (child_id, status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_service_slot_id" ON child_check_ins USING btree (service_slot_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_check_ins_status" ON child_check_ins USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_class_groups_age_group_id" ON child_class_groups USING btree (age_group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_guardians_child_id" ON child_guardians USING btree (child_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_age_group_id" ON child_profiles USING btree (age_group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_class_group_id" ON child_profiles USING btree (class_group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_firstname" ON child_profiles USING btree (firstname);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_child_profiles_lastname" ON child_profiles USING btree (lastname);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_church_classes_class_type_id" ON church_classes USING btree (class_type_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_churchClassId" ON class_enrollments USING btree (church_class_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_enrolledAt" ON class_enrollments USING btree (enrolled_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_enrollments_status_completedAt" ON class_enrollments USING btree (status, completed_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_types_is_active" ON class_types USING btree (is_active);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_convert_follow_up_logs_convert_id" ON convert_follow_up_logs USING btree (convert_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_assigned_to" ON converts USING btree (assigned_to);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_member_id" ON converts USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_onboarded_by" ON converts USING btree (onboarded_by);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_converts_status" ON converts USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_department_feedback_department_id" ON pastor_feedback USING btree (department_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_department_feedback_week_of" ON pastor_feedback USING btree (week_of);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_department_leads_worker_profile_id" ON department_leads USING btree (worker_profile_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_device_reset_otps_memberId" ON device_reset_otps USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_logs_createdAt" ON email_logs USING btree (created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_logs_recipient" ON email_logs USING btree (recipient);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_logs_status" ON email_logs USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_reminders_last_sent_at" ON event_reminders USING btree (last_sent_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_reminders_service_slot_id" ON event_reminders USING btree (service_slot_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_event_date" ON events USING btree (event_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_recurringEventId" ON events USING btree (recurring_event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_requests_category_id" ON finance_requests USING btree (category_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_first_timer_visits_event_id" ON first_timer_visits USING btree (event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_first_timer_visits_first_timer_id" ON first_timer_visits USING btree (first_timer_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_first_timers_created_at" ON first_timers USING btree (created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_notes_task_id" ON follow_up_notes USING btree (task_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_assigned_to_id" ON follow_up_tasks USING btree (assigned_to_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_event_id" ON follow_up_tasks USING btree (event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_member_id" ON follow_up_tasks USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_status" ON follow_up_tasks USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_status_due_date" ON follow_up_tasks USING btree (status, due_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_follow_up_tasks_type" ON follow_up_tasks USING btree (type);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_participants_session_id" ON game_participants USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_questions_game_id" ON game_questions USING btree (game_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_responses_session_id" ON game_responses USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_sessions_game_id" ON game_sessions USING btree (game_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_journal_entry_lines_account_id" ON finance_journal_entry_lines USING btree (account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_journal_entry_lines_entry_id" ON finance_journal_entry_lines USING btree (journal_entry_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_sessions_lastLogin" ON member_sessions USING btree (last_login);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_member_sessions_member_id" ON member_sessions USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_birth_month_birth_day" ON members USING btree (birth_month, birth_day);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_role" ON members USING btree (role);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_members_status" ON members USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notes_member_id" ON notes USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offerings_fund_id" ON finance_offerings USING btree (fund_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_otps_memberId" ON password_reset_otps USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_fixed_assignment_worker" ON prayer_fixed_assignments USING btree (worker_profile_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meeting_date" ON prayer_meetings USING btree (date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meeting_month_year" ON prayer_meetings USING btree (month, year);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meetings_selectionStatus" ON prayer_meetings USING btree (selection_status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_meetings_status" ON prayer_meetings USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_requests_member_id" ON prayer_requests USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_requests_status" ON prayer_requests USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_entries_reminderDaySent" ON prayer_roster_entries USING btree (reminder_day_sent);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_entries_reminderTwoDaySent" ON prayer_roster_entries USING btree (reminder_two_day_sent);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_entries_status" ON prayer_roster_entries USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_meeting" ON prayer_roster_entries USING btree (meeting_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prayer_roster_worker" ON prayer_roster_entries USING btree (worker_profile_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pregnancy_prayer_cases_member_id" ON pregnancy_prayer_cases USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pregnancy_prayer_cases_status" ON pregnancy_prayer_cases USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pregnancy_prayer_visits_case_id" ON pregnancy_prayer_visits USING btree (case_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reconciliation_rows_job_id" ON finance_reconciliation_rows USING btree (job_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_bookings_facility_id_status" ON rental_bookings USING btree (facility_id, status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_bookings_member_id" ON rental_bookings USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_bookings_start_date_time" ON rental_bookings USING btree (start_date_time);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_calendar_blocks_facility_id" ON rental_calendar_blocks USING btree (facility_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_payments_booking_id" ON rental_payments USING btree (booking_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_dateFrom" ON request_leave USING btree (date_from);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_dateTo" ON request_leave USING btree (date_to);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_status" ON request_leave USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_leave_worker_profile_id" ON request_leave USING btree (worker_profile_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sermon_notes_sermon_id" ON sermon_notes USING btree (sermon_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sermons_date" ON sermons USING btree (date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sermons_series" ON sermons USING btree (series);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_ratings_created_at_with_comment" ON service_ratings USING btree (created_at DESC) WHERE (comment IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_ratings_event_id" ON service_ratings USING btree (event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_end_time" ON service_slots USING btree (end_time);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_event_id" ON service_slots USING btree (event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_slots_start_time" ON service_slots USING btree (start_time);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_attendance_group_id" ON small_group_attendance USING btree (group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_attendance_group_id_meeting_date" ON small_group_attendance USING btree (group_id, meeting_date DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_members_group_id" ON small_group_members USING btree (group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_members_group_id_created_at" ON small_group_members USING btree (group_id, created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_small_group_members_member_id" ON small_group_members USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_attendances_markedAt" ON sunday_school_attendances USING btree (marked_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_attendances_member_id" ON sunday_school_attendances USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_attendances_session_id" ON sunday_school_attendances USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_members_assignedAt" ON sunday_school_members USING btree (assigned_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_members_member_id" ON sunday_school_members USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_members_sunday_school_class_id" ON sunday_school_members USING btree (sunday_school_class_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_sessions_sessionDate" ON sunday_school_sessions USING btree (session_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sunday_school_sessions_sunday_school_class_id" ON sunday_school_sessions USING btree (sunday_school_class_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_testimonies_is_public" ON testimonies USING btree (is_public);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_testimonies_member_id" ON testimonies USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_dispute_records_status" ON tithe_dispute_records USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_payment_proofs_status" ON tithe_payment_proofs USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_records_batch_id" ON tithe_records USING btree (batch_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_records_member_payment" ON tithe_records USING btree (member_id, payment_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_unmatched_records_status" ON tithe_unmatched_records USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tithe_upload_batches_status" ON tithe_upload_batches USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_volunteer_opportunities_date" ON volunteer_opportunities USING btree (date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_volunteer_opportunities_status_date" ON volunteer_opportunities USING btree (status, date);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_volunteer_signups_opportunity_id" ON volunteer_signups USING btree (opportunity_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_department_id" ON worker_profiles USING btree (department_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_is_trainee" ON worker_profiles USING btree (is_trainee);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_secondary_department_id" ON worker_profiles USING btree (secondary_department_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_worker_profiles_status" ON worker_profiles USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX finance_bank_import_profiles_default_idx ON finance_bank_import_profiles USING btree (is_default) WHERE (is_default = true);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_acc_periods_status ON finance_accounting_periods USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_acc_periods_year_month ON finance_accounting_periods USING btree (year, month);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_acn_checkout ON asset_checkout_notifications USING btree (checkout_id);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_acn_checkout_days ON asset_checkout_notifications USING btree (checkout_id, days_overdue) WHERE (days_overdue IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_announcements_group_id ON announcements USING btree (group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_checkouts_asset ON asset_checkouts USING btree (asset_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_checkouts_department ON asset_checkouts USING btree (checked_out_to_department_id) WHERE (checked_out_to_department_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_checkouts_expected_return ON asset_checkouts USING btree (expected_return_at) WHERE (expected_return_at IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_checkouts_member ON asset_checkouts USING btree (checked_out_to_member_id) WHERE (checked_out_to_member_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_checkouts_returned_at ON asset_checkouts USING btree (returned_at) WHERE (returned_at IS NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_insurance_expiry ON assets USING btree (insurance_expiry) WHERE (insurance_expiry IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_roadworthiness_expiry ON assets USING btree (roadworthiness_expiry) WHERE (roadworthiness_expiry IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_asset_schedules_next_due ON asset_maintenance_schedules USING btree (next_due_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_assets_department ON assets USING btree (department_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_assets_status ON assets USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_assets_warranty_expiry ON assets USING btree (warranty_expiry) WHERE (warranty_expiry IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_attendances_event_id ON attendances USING btree (event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budgets_account ON finance_budgets USING btree (account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budgets_date_range ON finance_budgets USING btree (start_date, end_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budgets_fund ON finance_budgets USING btree (fund_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_budgets_period_active ON finance_budgets USING btree (period, is_active);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_bulk_jobs_created_by ON finance_bulk_upload_jobs USING btree (created_by_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_bulk_jobs_status ON finance_bulk_upload_jobs USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_bulk_jobs_type ON finance_bulk_upload_jobs USING btree (upload_type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_email_change_otps_member_id ON email_change_otps USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_event_reminders_dispatch ON event_reminders USING btree (fire_at) WHERE ((enabled = true) AND (last_sent_at IS NULL));`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ext_payees_active ON finance_external_payees USING btree (is_active) WHERE (is_active = true);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ext_payees_type ON finance_external_payees USING btree (type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_fin_accounts_fund ON finance_accounts USING btree (fund_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_fin_accounts_subtype ON finance_accounts USING btree (subtype);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_fin_accounts_type_active ON finance_accounts USING btree (type, is_active);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_finance_accounts_code ON finance_accounts USING btree (code) WHERE (code IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_funds_active ON finance_funds USING btree (is_active) WHERE (is_active = true);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_funds_type ON finance_funds USING btree (type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_requests_department ON finance_requests USING btree (department_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_requests_requested_by ON finance_requests USING btree (requested_by);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_requests_status ON finance_requests USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_first_timers_visited_event ON first_timers USING btree (visited_event_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_notes_task ON follow_up_notes USING btree (task_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_tasks_assigned_to ON follow_up_tasks USING btree (assigned_to_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_tasks_status ON follow_up_tasks USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_follow_up_tasks_type ON follow_up_tasks USING btree (type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_group_members_group_id ON group_members USING btree (group_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_group_members_member_id ON group_members USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_headcount_service_slot ON service_headcounts USING btree (service_slot_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_incident_reports_reporter ON incident_reports USING btree (reporter_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_incident_reports_status ON incident_reports USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_created_by ON finance_journal_entries USING btree (created_by_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_date ON finance_journal_entries USING btree (date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_date_status ON finance_journal_entries USING btree (date, status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_entry_type ON finance_journal_entries USING btree (entry_type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_period ON finance_journal_entries USING btree (accounting_period_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_source ON finance_journal_entries USING btree (source);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_je_status ON finance_journal_entries USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jel_account ON finance_journal_entry_lines USING btree (account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jel_journal_entry ON finance_journal_entry_lines USING btree (journal_entry_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jel_type_account ON finance_journal_entry_lines USING btree (entry_type, account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jelk_department ON finance_journal_entry_links USING btree (department_id) WHERE (department_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jelk_journal_entry ON finance_journal_entry_links USING btree (journal_entry_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jelk_link_type ON finance_journal_entry_links USING btree (link_type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jelk_member ON finance_journal_entry_links USING btree (member_id) WHERE (member_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jelk_payee ON finance_journal_entry_links USING btree (external_payee_id) WHERE (external_payee_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_jelk_service_event ON finance_journal_entry_links USING btree (service_event_id) WHERE (service_event_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_maintenance_records_asset ON asset_maintenance_records USING btree (asset_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_member_import_rows_job_id ON member_import_rows USING btree (job_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_offerings_created_at ON finance_offerings USING btree (created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_offerings_fund ON finance_offerings USING btree (fund_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_offerings_reconciled ON finance_offerings USING btree (is_reconciled);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_offerings_recorded_by ON finance_offerings USING btree (recorded_by_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_offerings_service_event ON finance_offerings USING btree (service_event_id) WHERE (service_event_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_offerings_type ON finance_offerings USING btree (type);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_petty_cash_from_account ON finance_petty_cash_replenishments USING btree (from_account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_petty_cash_requested_by ON finance_petty_cash_replenishments USING btree (requested_by_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_petty_cash_status ON finance_petty_cash_replenishments USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_petty_cash_to_account ON finance_petty_cash_replenishments USING btree (to_cash_account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledge_campaigns_active ON finance_pledge_campaigns USING btree (is_active) WHERE (is_active = true);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledge_campaigns_dates ON finance_pledge_campaigns USING btree (start_date, end_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledge_campaigns_fund ON finance_pledge_campaigns USING btree (fund_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledge_contributions_pledge ON finance_pledge_contributions USING btree (pledge_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledge_contributions_status ON finance_pledge_contributions USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledge_contributions_submitted_by ON finance_pledge_contributions USING btree (submitted_by_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledges_campaign ON finance_pledges USING btree (campaign_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledges_member ON finance_pledges USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledges_member_status ON finance_pledges USING btree (member_id, status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pledges_status ON finance_pledges USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recon_confirmed_account ON finance_reconciliation_rows USING btree (confirmed_account_id) WHERE (confirmed_account_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recon_date ON finance_reconciliation_rows USING btree (transaction_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recon_job_status ON finance_reconciliation_rows USING btree (job_id, status);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_recon_row_fingerprint ON finance_reconciliation_rows USING btree (job_id, row_fingerprint);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recon_suggested_account ON finance_reconciliation_rows USING btree (suggested_account_id) WHERE (suggested_account_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recon_transaction_fingerprint ON finance_reconciliation_rows USING btree (transaction_fingerprint);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recurring_active_due ON finance_recurring_entries USING btree (next_due_at) WHERE (is_active = true);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recurring_credit_account ON finance_recurring_entries USING btree (credit_account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recurring_debit_account ON finance_recurring_entries USING btree (debit_account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_recurring_fund ON finance_recurring_entries USING btree (fund_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_action_entries_session ON service_action_entries USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_pause_entries_session ON service_pause_entries USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_programme_slots_member ON service_programme_slots USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_programme_slots_programme ON service_programme_slots USING btree (programme_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_programme_slots_reminder_pending ON service_programme_slots USING btree (reminder_sent_at) WHERE (reminder_sent_at IS NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_programmes_slot ON service_programmes USING btree (service_slot_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_programmes_status ON service_programmes USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_session_access_grants_session_id ON service_session_access_grants USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_session_slots_session ON service_session_slots USING btree (session_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_sessions_code ON service_sessions USING btree (session_code);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_sessions_programme ON service_sessions USING btree (programme_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_service_sessions_status ON service_sessions USING btree (status);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_accounts_account_number ON tithe_accounts USING btree (account_number);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_accounts_currency ON tithe_accounts USING btree (currency);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_accounts_is_active ON tithe_accounts USING btree (is_active);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_payment_proofs_payment_date ON tithe_payment_proofs USING btree (payment_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_payment_proofs_tithe_account_id ON tithe_payment_proofs USING btree (tithe_account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_records_member ON tithe_records USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_records_payment_date ON tithe_records USING btree (payment_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_source ON tithe_records USING btree (source);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_upload_batches_tithe_account_id ON tithe_upload_batches USING btree (tithe_account_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tithe_virtual_account ON tithe_records USING btree (virtual_account_id) WHERE (virtual_account_id IS NOT NULL);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_virtual_accounts_active ON member_virtual_accounts USING btree (is_active) WHERE (is_active = true);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_virtual_accounts_member ON member_virtual_accounts USING btree (member_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_virtual_accounts_member_provider ON member_virtual_accounts USING btree (member_id, provider);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_virtual_accounts_provider ON member_virtual_accounts USING btree (provider);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_attendances_member_event ON attendances USING btree (member_id, event_id);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_service_session_access_grants_session_name_active ON service_session_access_grants USING btree (session_id, lower((name)::text)) WHERE (revoked_at IS NULL);`,
    );
    await queryRunner.query(`ALTER TABLE ONLY admins
    ADD CONSTRAINT "FK_admins_admin_role_id" FOREIGN KEY (admin_role_id) REFERENCES admin_roles(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY admins
    ADD CONSTRAINT "FK_admins_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY announcements
    ADD CONSTRAINT "FK_announcements_authorId" FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY announcements
    ADD CONSTRAINT "FK_announcements_departmentId" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY announcements
    ADD CONSTRAINT "FK_announcements_group_id" FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY announcements
    ADD CONSTRAINT "FK_announcements_targetMemberId" FOREIGN KEY (target_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY attendances
    ADD CONSTRAINT "FK_attendances_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT "FK_audit_logs_actorId" FOREIGN KEY (actor_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY birthday_wishes
    ADD CONSTRAINT "FK_birthday_wishes_recipientId" FOREIGN KEY (recipient_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY birthday_wishes
    ADD CONSTRAINT "FK_birthday_wishes_senderId" FOREIGN KEY (sender_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "FK_child_check_ins_checked_in_by_id" FOREIGN KEY (checked_in_by_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "FK_child_check_ins_child_id" FOREIGN KEY (child_id) REFERENCES child_profiles(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "FK_child_check_ins_dropped_off_by_id" FOREIGN KEY (dropped_off_by_id) REFERENCES child_guardians(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "FK_child_check_ins_picked_up_by_id" FOREIGN KEY (picked_up_by_id) REFERENCES child_guardians(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_check_ins
    ADD CONSTRAINT "FK_child_check_ins_service_slot_id" FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_class_groups
    ADD CONSTRAINT "FK_child_class_groups_age_group_id" FOREIGN KEY (age_group_id) REFERENCES child_age_groups(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY child_guardians
    ADD CONSTRAINT "FK_child_guardians_child_id" FOREIGN KEY (child_id) REFERENCES child_profiles(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY child_guardians
    ADD CONSTRAINT "FK_child_guardians_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_profiles
    ADD CONSTRAINT "FK_child_profiles_age_group_id" FOREIGN KEY (age_group_id) REFERENCES child_age_groups(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_profiles
    ADD CONSTRAINT "FK_child_profiles_class_group_id" FOREIGN KEY (class_group_id) REFERENCES child_class_groups(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY child_profiles
    ADD CONSTRAINT "FK_child_profiles_registered_by_id" FOREIGN KEY (registered_by_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY church_classes
    ADD CONSTRAINT "FK_church_classes_class_type" FOREIGN KEY (class_type_id) REFERENCES class_types(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY church_classes
    ADD CONSTRAINT "FK_church_classes_facilitatorId" FOREIGN KEY (facilitator_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY class_enrollments
    ADD CONSTRAINT "FK_class_enrollments_churchClassId" FOREIGN KEY (church_class_id) REFERENCES church_classes(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY class_enrollments
    ADD CONSTRAINT "FK_class_enrollments_memberId" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY department_leads
    ADD CONSTRAINT "FK_department_leads_department_id" FOREIGN KEY (department_id) REFERENCES departments(id);`);
    await queryRunner.query(`ALTER TABLE ONLY department_leads
    ADD CONSTRAINT "FK_department_leads_worker_profile_id" FOREIGN KEY (worker_profile_id) REFERENCES worker_profiles(id);`);
    await queryRunner.query(`ALTER TABLE ONLY event_config
    ADD CONSTRAINT "FK_event_config_default_venue_id" FOREIGN KEY (default_venue_id) REFERENCES venues(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY event_reminders
    ADD CONSTRAINT "FK_event_reminders_department_id" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY event_reminders
    ADD CONSTRAINT "FK_event_reminders_service_slot_id" FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY group_members
    ADD CONSTRAINT "FK_group_members_added_by" FOREIGN KEY (added_by_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY group_members
    ADD CONSTRAINT "FK_group_members_group_id" FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY group_members
    ADD CONSTRAINT "FK_group_members_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY groups
    ADD CONSTRAINT "FK_groups_created_by" FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY member_sessions
    ADD CONSTRAINT "FK_member_sessions_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_fixed_assignments
    ADD CONSTRAINT "FK_prayer_fixed_assignment_day" FOREIGN KEY (day_config_id) REFERENCES prayer_day_configs(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_fixed_assignments
    ADD CONSTRAINT "FK_prayer_fixed_assignment_worker" FOREIGN KEY (worker_profile_id) REFERENCES worker_profiles(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_meetings
    ADD CONSTRAINT "FK_prayer_meeting_day_config" FOREIGN KEY (day_config_id) REFERENCES prayer_day_configs(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_roster_entries
    ADD CONSTRAINT "FK_prayer_roster_meeting" FOREIGN KEY (meeting_id) REFERENCES prayer_meetings(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_roster_entries
    ADD CONSTRAINT "FK_prayer_roster_rescheduled_from" FOREIGN KEY (rescheduled_from_id) REFERENCES prayer_roster_entries(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_roster_entries
    ADD CONSTRAINT "FK_prayer_roster_worker" FOREIGN KEY (worker_profile_id) REFERENCES worker_profiles(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT "FK_push_subscriptions_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_addons
    ADD CONSTRAINT "FK_rental_addons_asset_id" FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_booking_addons
    ADD CONSTRAINT "FK_rental_booking_addons_addon_id" FOREIGN KEY (addon_id) REFERENCES rental_addons(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_booking_addons
    ADD CONSTRAINT "FK_rental_booking_addons_booking_id" FOREIGN KEY (booking_id) REFERENCES rental_bookings(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_bookings
    ADD CONSTRAINT "FK_rental_bookings_facility_id" FOREIGN KEY (facility_id) REFERENCES rental_facilities(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_bookings
    ADD CONSTRAINT "FK_rental_bookings_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_calendar_blocks
    ADD CONSTRAINT "FK_rental_calendar_blocks_facility_id" FOREIGN KEY (facility_id) REFERENCES rental_facilities(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY rental_payments
    ADD CONSTRAINT "FK_rental_payments_booking_id" FOREIGN KEY (booking_id) REFERENCES rental_bookings(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY request_leave
    ADD CONSTRAINT "FK_request_leave_actioned_by" FOREIGN KEY (actioned_by) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY request_leave
    ADD CONSTRAINT "FK_request_leave_worker_profile_id" FOREIGN KEY (worker_profile_id) REFERENCES worker_profiles(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_access_grants
    ADD CONSTRAINT "FK_service_session_access_grants_granted_by_member_id" FOREIGN KEY (granted_by_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_access_grants
    ADD CONSTRAINT "FK_service_session_access_grants_session_id" FOREIGN KEY (session_id) REFERENCES service_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_slots
    ADD CONSTRAINT "FK_service_slots_config_id" FOREIGN KEY (config_id) REFERENCES event_config(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_slots
    ADD CONSTRAINT "FK_service_slots_event_id" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_slots
    ADD CONSTRAINT "FK_service_slots_venue_override_id" FOREIGN KEY (venue_override_id) REFERENCES venues(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_attendances
    ADD CONSTRAINT "FK_sunday_school_attendances_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_attendances
    ADD CONSTRAINT "FK_sunday_school_attendances_session_id" FOREIGN KEY (session_id) REFERENCES sunday_school_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_classes
    ADD CONSTRAINT "FK_sunday_school_classes_teacher_id" FOREIGN KEY (teacher_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_members
    ADD CONSTRAINT "FK_sunday_school_members_member_id" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_members
    ADD CONSTRAINT "FK_sunday_school_members_sunday_school_class_id" FOREIGN KEY (sunday_school_class_id) REFERENCES sunday_school_classes(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY sunday_school_sessions
    ADD CONSTRAINT "FK_sunday_school_sessions_sunday_school_class_id" FOREIGN KEY (sunday_school_class_id) REFERENCES sunday_school_classes(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_payment_proofs
    ADD CONSTRAINT "FK_tithe_payment_proofs_admin" FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_payment_proofs
    ADD CONSTRAINT "FK_tithe_payment_proofs_member" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY worker_profiles
    ADD CONSTRAINT "FK_worker_profiles_department_id" FOREIGN KEY (department_id) REFERENCES departments(id);`);
    await queryRunner.query(`ALTER TABLE ONLY worker_profiles
    ADD CONSTRAINT "FK_worker_profiles_member_id" FOREIGN KEY (member_id) REFERENCES members(id);`);
    await queryRunner.query(`ALTER TABLE ONLY worker_profiles
    ADD CONSTRAINT "FK_worker_profiles_secondary_department_id" FOREIGN KEY (secondary_department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY announcement_reactions
    ADD CONSTRAINT announcement_reactions_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY announcement_reactions
    ADD CONSTRAINT announcement_reactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkout_notifications
    ADD CONSTRAINT asset_checkout_notifications_checkout_id_fkey FOREIGN KEY (checkout_id) REFERENCES asset_checkouts(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkouts
    ADD CONSTRAINT asset_checkouts_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkouts
    ADD CONSTRAINT asset_checkouts_checked_out_by_admin_id_fkey FOREIGN KEY (checked_out_by_admin_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkouts
    ADD CONSTRAINT asset_checkouts_checked_out_to_department_id_fkey FOREIGN KEY (checked_out_to_department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkouts
    ADD CONSTRAINT asset_checkouts_checked_out_to_member_id_fkey FOREIGN KEY (checked_out_to_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_checkouts
    ADD CONSTRAINT asset_checkouts_returned_by_admin_id_fkey FOREIGN KEY (returned_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_maintenance_records
    ADD CONSTRAINT asset_maintenance_records_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_maintenance_records
    ADD CONSTRAINT asset_maintenance_records_logged_by_id_fkey FOREIGN KEY (logged_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY asset_maintenance_schedules
    ADD CONSTRAINT asset_maintenance_schedules_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY assets
    ADD CONSTRAINT assets_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY class_types
    ADD CONSTRAINT class_types_next_class_type_id_fkey FOREIGN KEY (next_class_type_id) REFERENCES class_types(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY convert_follow_up_logs
    ADD CONSTRAINT convert_follow_up_logs_convert_id_fkey FOREIGN KEY (convert_id) REFERENCES converts(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY convert_follow_up_logs
    ADD CONSTRAINT convert_follow_up_logs_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY converts
    ADD CONSTRAINT converts_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES worker_profiles(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY converts
    ADD CONSTRAINT converts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY converts
    ADD CONSTRAINT converts_onboarded_by_fkey FOREIGN KEY (onboarded_by) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY pastor_feedback
    ADD CONSTRAINT department_feedback_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY pastor_feedback
    ADD CONSTRAINT department_feedback_responded_by_pastor_id_fkey FOREIGN KEY (responded_by_pastor_id) REFERENCES pastors(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY pastor_feedback
    ADD CONSTRAINT department_feedback_submitted_by_id_fkey FOREIGN KEY (submitted_by_id) REFERENCES worker_profiles(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_accounting_periods
    ADD CONSTRAINT finance_accounting_periods_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_accounts
    ADD CONSTRAINT finance_accounts_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES finance_funds(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_bank_import_profiles
    ADD CONSTRAINT finance_bank_import_profiles_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_budgets
    ADD CONSTRAINT finance_budgets_account_id_fkey FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_budgets
    ADD CONSTRAINT finance_budgets_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_budgets
    ADD CONSTRAINT finance_budgets_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES finance_funds(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_bulk_upload_jobs
    ADD CONSTRAINT finance_bulk_upload_jobs_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_bulk_upload_jobs
    ADD CONSTRAINT finance_bulk_upload_jobs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES finance_bank_import_profiles(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_accounting_period_id_fkey FOREIGN KEY (accounting_period_id) REFERENCES finance_accounting_periods(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_approved_by_id_fkey FOREIGN KEY (approved_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entries
    ADD CONSTRAINT finance_journal_entries_reversal_of_id_fkey FOREIGN KEY (reversal_of_id) REFERENCES finance_journal_entries(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_lines
    ADD CONSTRAINT finance_journal_entry_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_lines
    ADD CONSTRAINT finance_journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES finance_journal_entries(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_links
    ADD CONSTRAINT finance_journal_entry_links_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_links
    ADD CONSTRAINT finance_journal_entry_links_external_payee_id_fkey FOREIGN KEY (external_payee_id) REFERENCES finance_external_payees(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_links
    ADD CONSTRAINT finance_journal_entry_links_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES finance_journal_entries(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_journal_entry_links
    ADD CONSTRAINT finance_journal_entry_links_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_offerings
    ADD CONSTRAINT finance_offerings_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES finance_funds(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_offerings
    ADD CONSTRAINT finance_offerings_reconciled_by_id_fkey FOREIGN KEY (reconciled_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_offerings
    ADD CONSTRAINT finance_offerings_recorded_by_id_fkey FOREIGN KEY (recorded_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_petty_cash_replenishments
    ADD CONSTRAINT finance_petty_cash_replenishments_approved_by_id_fkey FOREIGN KEY (approved_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_petty_cash_replenishments
    ADD CONSTRAINT finance_petty_cash_replenishments_from_account_id_fkey FOREIGN KEY (from_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_petty_cash_replenishments
    ADD CONSTRAINT finance_petty_cash_replenishments_requested_by_id_fkey FOREIGN KEY (requested_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_petty_cash_replenishments
    ADD CONSTRAINT finance_petty_cash_replenishments_to_cash_account_id_fkey FOREIGN KEY (to_cash_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_campaigns
    ADD CONSTRAINT finance_pledge_campaigns_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_campaigns
    ADD CONSTRAINT finance_pledge_campaigns_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES finance_funds(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_contributions
    ADD CONSTRAINT finance_pledge_contributions_pledge_id_fkey FOREIGN KEY (pledge_id) REFERENCES finance_pledges(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_contributions
    ADD CONSTRAINT finance_pledge_contributions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledge_contributions
    ADD CONSTRAINT finance_pledge_contributions_submitted_by_id_fkey FOREIGN KEY (submitted_by_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledges
    ADD CONSTRAINT finance_pledges_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES finance_pledge_campaigns(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_pledges
    ADD CONSTRAINT finance_pledges_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_reconciliation_rows
    ADD CONSTRAINT finance_reconciliation_rows_confirmed_account_id_fkey FOREIGN KEY (confirmed_account_id) REFERENCES finance_accounts(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_reconciliation_rows
    ADD CONSTRAINT finance_reconciliation_rows_job_id_fkey FOREIGN KEY (job_id) REFERENCES finance_bulk_upload_jobs(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_reconciliation_rows
    ADD CONSTRAINT finance_reconciliation_rows_suggested_account_id_fkey FOREIGN KEY (suggested_account_id) REFERENCES finance_accounts(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_recurring_entries
    ADD CONSTRAINT finance_recurring_entries_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_recurring_entries
    ADD CONSTRAINT finance_recurring_entries_credit_account_id_fkey FOREIGN KEY (credit_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_recurring_entries
    ADD CONSTRAINT finance_recurring_entries_debit_account_id_fkey FOREIGN KEY (debit_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_recurring_entries
    ADD CONSTRAINT finance_recurring_entries_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES finance_funds(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_requests
    ADD CONSTRAINT finance_requests_category_id_fkey FOREIGN KEY (category_id) REFERENCES finance_categories(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_requests
    ADD CONSTRAINT finance_requests_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_requests
    ADD CONSTRAINT finance_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY finance_requests
    ADD CONSTRAINT finance_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY first_timer_visits
    ADD CONSTRAINT first_timer_visits_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY first_timer_visits
    ADD CONSTRAINT first_timer_visits_first_timer_id_fkey FOREIGN KEY (first_timer_id) REFERENCES first_timers(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY first_timers
    ADD CONSTRAINT first_timers_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY first_timers
    ADD CONSTRAINT first_timers_created_by_member_id_fkey FOREIGN KEY (created_by_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY first_timers
    ADD CONSTRAINT first_timers_visited_event_id_fkey FOREIGN KEY (visited_event_id) REFERENCES events(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY attendances
    ADD CONSTRAINT fk_attendances_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY attendances
    ADD CONSTRAINT fk_attendances_service_slot FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY first_timers
    ADD CONSTRAINT fk_first_timers_converted_member FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_headcounts
    ADD CONSTRAINT fk_headcount_recorded_by FOREIGN KEY (recorded_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_headcounts
    ADD CONSTRAINT fk_headcount_service_slot FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_day_configs
    ADD CONSTRAINT fk_prayer_day_config_program FOREIGN KEY (program_id) REFERENCES prayer_programs(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_meetings
    ADD CONSTRAINT fk_prayer_meeting_program FOREIGN KEY (program_id) REFERENCES prayer_programs(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_roster_entries
    ADD CONSTRAINT fk_prayer_roster_entry_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_schedule_rules
    ADD CONSTRAINT fk_prayer_schedule_rule_program FOREIGN KEY (program_id) REFERENCES prayer_programs(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY service_action_entries
    ADD CONSTRAINT fk_sae_member FOREIGN KEY (performed_by_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_action_entries
    ADD CONSTRAINT fk_sae_session FOREIGN KEY (session_id) REFERENCES service_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_programmes
    ADD CONSTRAINT fk_sp_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_programmes
    ADD CONSTRAINT fk_sp_service_slot FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_pause_entries
    ADD CONSTRAINT fk_spe_session FOREIGN KEY (session_id) REFERENCES service_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_programme_slots
    ADD CONSTRAINT fk_sps_backup_member FOREIGN KEY (backup_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_programme_slots
    ADD CONSTRAINT fk_sps_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_programme_slots
    ADD CONSTRAINT fk_sps_programme FOREIGN KEY (programme_id) REFERENCES service_programmes(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_programme_templates
    ADD CONSTRAINT fk_spt_programme FOREIGN KEY (created_from_id) REFERENCES service_programmes(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_sessions
    ADD CONSTRAINT fk_ss_programme FOREIGN KEY (programme_id) REFERENCES service_programmes(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_slots
    ADD CONSTRAINT fk_sss_overridden_member FOREIGN KEY (overridden_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_slots
    ADD CONSTRAINT fk_sss_programme_slot FOREIGN KEY (programme_slot_id) REFERENCES service_programme_slots(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_session_slots
    ADD CONSTRAINT fk_sss_session FOREIGN KEY (session_id) REFERENCES service_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_notes
    ADD CONSTRAINT follow_up_notes_added_by_id_fkey FOREIGN KEY (added_by_id) REFERENCES worker_profiles(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_notes
    ADD CONSTRAINT follow_up_notes_task_id_fkey FOREIGN KEY (task_id) REFERENCES follow_up_tasks(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_first_timer_id_fkey FOREIGN KEY (first_timer_id) REFERENCES first_timers(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY game_participants
    ADD CONSTRAINT game_participants_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_participants
    ADD CONSTRAINT game_participants_session_id_fkey FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_questions
    ADD CONSTRAINT game_questions_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_responses
    ADD CONSTRAINT game_responses_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES game_participants(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_responses
    ADD CONSTRAINT game_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES game_questions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_responses
    ADD CONSTRAINT game_responses_session_id_fkey FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_sessions
    ADD CONSTRAINT game_sessions_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY game_sessions
    ADD CONSTRAINT game_sessions_host_admin_id_fkey FOREIGN KEY (host_admin_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY games
    ADD CONSTRAINT games_church_class_id_fkey FOREIGN KEY (church_class_id) REFERENCES church_classes(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY games
    ADD CONSTRAINT games_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY games
    ADD CONSTRAINT games_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY incident_reports
    ADD CONSTRAINT incident_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY member_import_jobs
    ADD CONSTRAINT member_import_jobs_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY member_import_rows
    ADD CONSTRAINT member_import_rows_job_id_fkey FOREIGN KEY (job_id) REFERENCES member_import_jobs(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY member_virtual_accounts
    ADD CONSTRAINT member_virtual_accounts_deactivated_by_id_fkey FOREIGN KEY (deactivated_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY member_virtual_accounts
    ADD CONSTRAINT member_virtual_accounts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY notes
    ADD CONSTRAINT notes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY pastors
    ADD CONSTRAINT pastors_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY prayer_requests
    ADD CONSTRAINT prayer_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY pregnancy_prayer_cases
    ADD CONSTRAINT pregnancy_prayer_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY pregnancy_prayer_cases
    ADD CONSTRAINT pregnancy_prayer_cases_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY pregnancy_prayer_visits
    ADD CONSTRAINT pregnancy_prayer_visits_case_id_fkey FOREIGN KEY (case_id) REFERENCES pregnancy_prayer_cases(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY pregnancy_prayer_visits
    ADD CONSTRAINT pregnancy_prayer_visits_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY sermon_notes
    ADD CONSTRAINT sermon_notes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY sermon_notes
    ADD CONSTRAINT sermon_notes_sermon_id_fkey FOREIGN KEY (sermon_id) REFERENCES sermons(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY sermons
    ADD CONSTRAINT sermons_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY service_ratings
    ADD CONSTRAINT service_ratings_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_ratings
    ADD CONSTRAINT service_ratings_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY service_ratings
    ADD CONSTRAINT service_ratings_service_slot_id_fkey FOREIGN KEY (service_slot_id) REFERENCES service_slots(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_attendance
    ADD CONSTRAINT small_group_attendance_group_id_fkey FOREIGN KEY (group_id) REFERENCES small_groups(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_attendance
    ADD CONSTRAINT small_group_attendance_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_members
    ADD CONSTRAINT small_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES small_groups(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY small_group_members
    ADD CONSTRAINT small_group_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY small_groups
    ADD CONSTRAINT small_groups_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY small_groups
    ADD CONSTRAINT small_groups_leader_id_fkey FOREIGN KEY (leader_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY testimonies
    ADD CONSTRAINT testimonies_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY testimonies
    ADD CONSTRAINT testimonies_prayer_request_id_fkey FOREIGN KEY (prayer_request_id) REFERENCES prayer_requests(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_dispute_records
    ADD CONSTRAINT tithe_dispute_records_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES tithe_upload_batches(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_dispute_records
    ADD CONSTRAINT tithe_dispute_records_existing_record_id_fkey FOREIGN KEY (existing_record_id) REFERENCES tithe_records(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_dispute_records
    ADD CONSTRAINT tithe_dispute_records_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_dispute_records
    ADD CONSTRAINT tithe_dispute_records_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_payment_proofs
    ADD CONSTRAINT tithe_payment_proofs_tithe_account_id_fkey FOREIGN KEY (tithe_account_id) REFERENCES tithe_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_records
    ADD CONSTRAINT tithe_records_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES tithe_upload_batches(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_records
    ADD CONSTRAINT tithe_records_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_records
    ADD CONSTRAINT tithe_records_virtual_account_id_fkey FOREIGN KEY (virtual_account_id) REFERENCES member_virtual_accounts(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_unmatched_records
    ADD CONSTRAINT tithe_unmatched_records_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES tithe_upload_batches(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_unmatched_records
    ADD CONSTRAINT tithe_unmatched_records_matched_member_id_fkey FOREIGN KEY (matched_member_id) REFERENCES members(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_unmatched_records
    ADD CONSTRAINT tithe_unmatched_records_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_upload_batches
    ADD CONSTRAINT tithe_upload_batches_tithe_account_id_fkey FOREIGN KEY (tithe_account_id) REFERENCES tithe_accounts(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY tithe_upload_batches
    ADD CONSTRAINT tithe_upload_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES admins(id) ON DELETE RESTRICT;`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_opportunities
    ADD CONSTRAINT volunteer_opportunities_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES admins(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_opportunities
    ADD CONSTRAINT volunteer_opportunities_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_signups
    ADD CONSTRAINT volunteer_signups_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE ONLY volunteer_signups
    ADD CONSTRAINT volunteer_signups_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES volunteer_opportunities(id) ON DELETE CASCADE;`);
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '0a5a96d8-b732-4dfa-a6e9-7d3d24d5c6f0', 'Super Admin', 'Full access to all modules and administrative functions.', '{members:read,members:write,events:read,events:write,venues:read,venues:write,departments:read,departments:write,attendance:read,leave:read,leave:write,classes:read,classes:write,announcements:read,announcements:write,notes:read,notes:write,dashboard:read,sunday_school:read,sunday_school:write,children_church:read,children_church:write,admin:read,admin:write,audit:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '4221287f-8e83-457a-93ca-7c6c41ed9f20', 'General Admin', 'Broad operational access. Cannot manage admin users or view audit logs.', '{members:read,members:write,events:read,events:write,venues:read,venues:write,departments:read,departments:write,attendance:read,leave:read,leave:write,classes:read,classes:write,announcements:read,announcements:write,notes:read,notes:write,dashboard:read,sunday_school:read,sunday_school:write,children_church:read,children_church:write,admin:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '69e3117a-1003-44c8-8dd4-1466b7b1d7b9', 'Member Coordinator', 'Manages member records, worker promotions, department assignments, and attendance data.', '{members:read,members:write,departments:read,attendance:read,dashboard:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '93e0e15e-b05c-4afb-abc8-52aa5e9271a7', 'Content Manager', 'Creates and manages announcements, events, and venue records.', '{announcements:read,announcements:write,events:read,events:write,venues:read,venues:write,dashboard:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '1a717cb0-d25b-4c45-a5e3-3e54cc28b16a', 'Welfare & Pastoral', 'Handles pastoral notes, leave approvals, and general member welfare.', '{notes:read,notes:write,members:read,leave:read,leave:write,departments:read,dashboard:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '50bd054d-8223-4cfc-a727-511967cb7480', 'Children Church Coordinator', 'Manages the Children''s Church module — age groups, class groups, child profiles, and check-ins.', '{children_church:read,children_church:write,members:read,attendance:read,dashboard:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '87839838-a6a7-4634-b2a0-334106ea6b57', 'Sunday School Coordinator', 'Manages Sunday School classes, sessions, and member attendance.', '{sunday_school:read,sunday_school:write,members:read,attendance:read,dashboard:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', 'd1eae804-4431-44d6-926f-2d876c0030b5', 'Attendance Monitor', 'Read-only view of attendance records, event schedules, and the dashboard.', '{attendance:read,events:read,venues:read,members:read,departments:read,dashboard:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO admin_roles (created_at, updated_at, id, name, description, permissions) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', 'c55b8621-ed5d-4c18-b99f-e14418324d02', 'Leave Approver', 'Reviews and approves or rejects worker leave requests.', '{leave:read,leave:write,members:read,departments:read}');`,
    );
    await queryRunner.query(
      `INSERT INTO class_types (id, name, description, is_active, next_class_type_id, created_at, updated_at) VALUES ('11111111-0000-0000-0000-000000000001', 'Believers'' Class', NULL, true, NULL, '2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00');`,
    );
    await queryRunner.query(
      `INSERT INTO class_types (id, name, description, is_active, next_class_type_id, created_at, updated_at) VALUES ('11111111-0000-0000-0000-000000000002', 'Baptismal Class', NULL, true, NULL, '2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00');`,
    );
    await queryRunner.query(
      `INSERT INTO class_types (id, name, description, is_active, next_class_type_id, created_at, updated_at) VALUES ('11111111-0000-0000-0000-000000000003', 'Workers in Training', NULL, true, NULL, '2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00');`,
    );
    await queryRunner.query(
      `INSERT INTO class_types (id, name, description, is_active, next_class_type_id, created_at, updated_at) VALUES ('11111111-0000-0000-0000-000000000004', 'Bible College', NULL, true, NULL, '2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00');`,
    );
    await queryRunner.query(
      `INSERT INTO class_types (id, name, description, is_active, next_class_type_id, created_at, updated_at) VALUES ('11111111-0000-0000-0000-000000000005', 'School of Discipleship', NULL, true, NULL, '2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00');`,
    );
    await queryRunner.query(
      `INSERT INTO prayer_programs (id, name, description, audience, selection_window_days, is_active, created_at, updated_at) VALUES ('c0681e89-405f-4d49-983c-8b5fdd518a66', 'Prayer Program', NULL, 'WORKERS', 7, true, '2026-07-31 06:34:07.105604', '2026-07-31 06:34:07.105604');`,
    );
    await queryRunner.query(
      `INSERT INTO prayer_schedule_rules (created_at, updated_at, id, type, target_lead_type, value, description, is_active, program_id) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '956d4ff1-72ae-4adf-bdfe-e03ea96b2e79', 'ROLE_FREQUENCY', NULL, 1, 'Default: every worker prays once per month', true, 'c0681e89-405f-4d49-983c-8b5fdd518a66');`,
    );
    await queryRunner.query(
      `INSERT INTO prayer_schedule_rules (created_at, updated_at, id, type, target_lead_type, value, description, is_active, program_id) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '0677f778-b03c-4e0d-870c-8673dee79de7', 'ROLE_FREQUENCY', 'HOD', 2, 'HOD prays twice per month', true, 'c0681e89-405f-4d49-983c-8b5fdd518a66');`,
    );
    await queryRunner.query(
      `INSERT INTO prayer_schedule_rules (created_at, updated_at, id, type, target_lead_type, value, description, is_active, program_id) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', 'f1a9ea41-5e31-4dc7-a9c5-63f87d698afb', 'ROLE_FREQUENCY', 'D. HOD', 2, 'Deputy HOD prays twice per month', true, 'c0681e89-405f-4d49-983c-8b5fdd518a66');`,
    );
    await queryRunner.query(
      `INSERT INTO prayer_schedule_rules (created_at, updated_at, id, type, target_lead_type, value, description, is_active, program_id) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '37606e70-0985-4d21-b9a9-acf59ef8cabb', 'MIN_LEADERS_PER_MEETING', NULL, 1, 'At least 1 HOD or Deputy HOD per prayer meeting', true, 'c0681e89-405f-4d49-983c-8b5fdd518a66');`,
    );
    await queryRunner.query(
      `INSERT INTO prayer_schedule_rules (created_at, updated_at, id, type, target_lead_type, value, description, is_active, program_id) VALUES ('2026-07-31 06:34:07.105604+00', '2026-07-31 06:34:07.105604+00', '250ff3b6-d4c1-49a6-8679-0f1cdadd2001', 'MAX_PER_MEETING', NULL, 5, 'Maximum workers per prayer meeting', true, 'c0681e89-405f-4d49-983c-8b5fdd518a66');`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Baseline's own down() drops and recreates `public` unconditionally —
    // copying that here verbatim would drop the platform control-plane
    // schema (tenants/plans/subscriptions) the moment this ever ran against
    // the wrong connection. current_schema() reads whatever schema the
    // connection's search_path actually resolves to (TenantProvisioningService
    // sets it via the `options: '-c search_path=...'` connection parameter,
    // not the DataSource `schema` option — that option only affects
    // TypeORM's own generated SQL, not this migration's raw queries, and
    // fighting the two against each other broke the migrations-tracking
    // table's own qualification during testing). Refuses outright if the
    // resolved schema is missing or `public` — this migration must only
    // ever run scoped to a real tenant schema.
    const [{ current_schema: schema }] = await queryRunner.query(
      'SELECT current_schema()',
    );
    if (!schema || schema === 'public') {
      throw new Error(
        'TenantSchemaGenesis.down() refuses to run without an explicit non-public schema — this would drop the control-plane public schema.',
      );
    }
    await queryRunner.query(`DROP SCHEMA "${schema}" CASCADE;`);
    await queryRunner.query(`CREATE SCHEMA "${schema}";`);
  }
}
