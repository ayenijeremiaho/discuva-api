import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-schema twin of ../1791763200000-AddMissingForeignKeyIndexes.ts —
// same underlying gap (Postgres never auto-indexes the referencing side of
// a foreign key), same fix, against the tenant-schema copy of each table.
export class AddMissingForeignKeyIndexes1791590400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_announcement_reactions_member_id ON announcement_reactions(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_announcements_author_id ON announcements(author_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkout_notifications_checkout_id ON asset_checkout_notifications(checkout_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkouts_checked_out_by_admin_id ON asset_checkouts(checked_out_by_admin_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkouts_checked_out_to_department_id ON asset_checkouts(checked_out_to_department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkouts_checked_out_to_member_id ON asset_checkouts(checked_out_to_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_checkouts_returned_by_admin_id ON asset_checkouts(returned_by_admin_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_maintenance_records_asset_id ON asset_maintenance_records(asset_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_asset_maintenance_records_logged_by_id ON asset_maintenance_records(logged_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_assets_department_id ON assets(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_assignment_submissions_graded_by ON assignment_submissions(graded_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_birthday_wishes_sender_id ON birthday_wishes(sender_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_check_ins_checked_in_by_id ON child_check_ins(checked_in_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_check_ins_dropped_off_by_id ON child_check_ins(dropped_off_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_check_ins_picked_up_by_id ON child_check_ins(picked_up_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_guardians_member_id ON child_guardians(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_child_profiles_registered_by_id ON child_profiles(registered_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_church_classes_facilitator_id ON church_classes(facilitator_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_class_types_next_class_type_id ON class_types(next_class_type_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_convert_follow_up_logs_logged_by ON convert_follow_up_logs(logged_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_event_config_default_venue_id ON event_config(default_venue_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_event_reminders_department_id ON event_reminders(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_accounting_periods_closed_by_id ON finance_accounting_periods(closed_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_accounts_fund_id ON finance_accounts(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_bank_import_profiles_created_by_id ON finance_bank_import_profiles(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_budgets_account_id ON finance_budgets(account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_budgets_created_by_id ON finance_budgets(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_budgets_fund_id ON finance_budgets(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_bulk_upload_jobs_created_by_id ON finance_bulk_upload_jobs(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_bulk_upload_jobs_profile_id ON finance_bulk_upload_jobs(profile_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_accounting_period_id ON finance_journal_entries(accounting_period_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_approved_by_id ON finance_journal_entries(approved_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_created_by_id ON finance_journal_entries(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_reversal_of_id ON finance_journal_entries(reversal_of_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entry_links_department_id ON finance_journal_entry_links(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entry_links_external_payee_id ON finance_journal_entry_links(external_payee_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entry_links_journal_entry_id ON finance_journal_entry_links(journal_entry_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_journal_entry_links_member_id ON finance_journal_entry_links(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_offerings_reconciled_by_id ON finance_offerings(reconciled_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_offerings_recorded_by_id ON finance_offerings(recorded_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_petty_cash_replenishments_approved_by_id ON finance_petty_cash_replenishments(approved_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_petty_cash_replenishments_from_account_id ON finance_petty_cash_replenishments(from_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_petty_cash_replenishments_requested_by_id ON finance_petty_cash_replenishments(requested_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_petty_cash_replenishments_to_cash_account_id ON finance_petty_cash_replenishments(to_cash_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledge_campaigns_created_by_id ON finance_pledge_campaigns(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledge_campaigns_fund_id ON finance_pledge_campaigns(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledge_contributions_pledge_id ON finance_pledge_contributions(pledge_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledge_contributions_reviewed_by ON finance_pledge_contributions(reviewed_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledge_contributions_submitted_by_id ON finance_pledge_contributions(submitted_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledges_campaign_id ON finance_pledges(campaign_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pledges_member_id ON finance_pledges(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_rows_confirmed_account_id ON finance_reconciliation_rows(confirmed_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_rows_suggested_account_id ON finance_reconciliation_rows(suggested_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_recurring_entries_created_by_id ON finance_recurring_entries(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_recurring_entries_credit_account_id ON finance_recurring_entries(credit_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_recurring_entries_debit_account_id ON finance_recurring_entries(debit_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_recurring_entries_fund_id ON finance_recurring_entries(fund_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_requests_category_id ON finance_requests(category_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_requests_department_id ON finance_requests(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_requests_requested_by ON finance_requests(requested_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_requests_reviewed_by ON finance_requests(reviewed_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_first_timers_converted_member_id ON first_timers(converted_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_first_timers_created_by_admin_id ON first_timers(created_by_admin_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_first_timers_created_by_member_id ON first_timers(created_by_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_first_timers_visited_event_id ON first_timers(visited_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_follow_up_notes_added_by_id ON follow_up_notes(added_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_assigned_to_id ON follow_up_tasks(assigned_to_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_game_participants_member_id ON game_participants(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_game_responses_participant_id ON game_responses(participant_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_game_responses_question_id ON game_responses(question_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_game_sessions_host_admin_id ON game_sessions(host_admin_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_games_church_class_id ON games(church_class_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_games_created_by_id ON games(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_games_department_id ON games(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_group_members_added_by_id ON group_members(added_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_groups_created_by_id ON groups(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_incident_reports_reporter_id ON incident_reports(reporter_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_member_import_jobs_created_by_id ON member_import_jobs(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_member_virtual_accounts_deactivated_by_id ON member_virtual_accounts(deactivated_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_member_virtual_accounts_member_id ON member_virtual_accounts(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pastor_feedback_responded_by_pastor_id ON pastor_feedback(responded_by_pastor_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pastor_feedback_submitted_by_id ON pastor_feedback(submitted_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_prayer_day_configs_program_id ON prayer_day_configs(program_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_prayer_fixed_assignments_day_config_id ON prayer_fixed_assignments(day_config_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_prayer_meetings_day_config_id ON prayer_meetings(day_config_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_prayer_roster_entries_rescheduled_from_id ON prayer_roster_entries(rescheduled_from_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_prayer_schedule_rules_program_id ON prayer_schedule_rules(program_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pregnancy_prayer_cases_created_by ON pregnancy_prayer_cases(created_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pregnancy_prayer_visits_logged_by ON pregnancy_prayer_visits(logged_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_addons_asset_id ON rental_addons(asset_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_booking_addons_addon_id ON rental_booking_addons(addon_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_booking_addons_booking_id ON rental_booking_addons(booking_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_bookings_facility_id ON rental_bookings(facility_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_bookings_member_id ON rental_bookings(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_calendar_blocks_facility_id ON rental_calendar_blocks(facility_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_payments_booking_id ON rental_payments(booking_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_request_leave_actioned_by ON request_leave(actioned_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sermon_notes_member_id ON sermon_notes(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sermons_created_by_id ON sermons(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_action_entries_performed_by_member_id ON service_action_entries(performed_by_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_headcounts_recorded_by_id ON service_headcounts(recorded_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_programme_slots_backup_member_id ON service_programme_slots(backup_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_programme_slots_member_id ON service_programme_slots(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_programme_templates_created_from_id ON service_programme_templates(created_from_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_programmes_created_by_admin_id ON service_programmes(created_by_admin_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_ratings_member_id ON service_ratings(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_ratings_service_slot_id ON service_ratings(service_slot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_session_access_grants_granted_by_member_id ON service_session_access_grants(granted_by_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_session_slots_overridden_member_id ON service_session_slots(overridden_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_session_slots_programme_slot_id ON service_session_slots(programme_slot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_slots_config_id ON service_slots(config_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_service_slots_venue_override_id ON service_slots(venue_override_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_small_group_attendance_member_id ON small_group_attendance(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_small_group_members_member_id ON small_group_members(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_small_groups_created_by_id ON small_groups(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_small_groups_leader_id ON small_groups(leader_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_social_accounts_connected_by ON social_accounts(connected_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_social_posts_created_by ON social_posts(created_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sunday_school_classes_teacher_id ON sunday_school_classes(teacher_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_testimonies_prayer_request_id ON testimonies(prayer_request_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_dispute_records_batch_id ON tithe_dispute_records(batch_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_dispute_records_existing_record_id ON tithe_dispute_records(existing_record_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_dispute_records_member_id ON tithe_dispute_records(member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_dispute_records_reviewed_by ON tithe_dispute_records(reviewed_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_payment_proofs_reviewed_by ON tithe_payment_proofs(reviewed_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_records_virtual_account_id ON tithe_records(virtual_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_unmatched_records_batch_id ON tithe_unmatched_records(batch_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_unmatched_records_matched_member_id ON tithe_unmatched_records(matched_member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_unmatched_records_resolved_by ON tithe_unmatched_records(resolved_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tithe_upload_batches_uploaded_by ON tithe_upload_batches(uploaded_by)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_volunteer_opportunities_created_by_id ON volunteer_opportunities(created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_volunteer_opportunities_department_id ON volunteer_opportunities(department_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_volunteer_signups_member_id ON volunteer_signups(member_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_announcement_reactions_member_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_announcements_author_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkout_notifications_checkout_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_checked_out_by_admin_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_checked_out_to_department_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_checked_out_to_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_checkouts_returned_by_admin_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_maintenance_records_asset_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_asset_maintenance_records_logged_by_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_assets_department_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_assignment_submissions_graded_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_birthday_wishes_sender_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_child_check_ins_checked_in_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_child_check_ins_dropped_off_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_child_check_ins_picked_up_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_child_guardians_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_child_profiles_registered_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_church_classes_facilitator_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_class_types_next_class_type_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_convert_follow_up_logs_logged_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_event_config_default_venue_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_event_reminders_department_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_accounting_periods_closed_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_accounts_fund_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_bank_import_profiles_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_budgets_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_budgets_created_by_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_finance_budgets_fund_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_bulk_upload_jobs_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_bulk_upload_jobs_profile_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entries_accounting_period_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entries_approved_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entries_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entries_reversal_of_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entry_links_department_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entry_links_external_payee_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entry_links_journal_entry_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_journal_entry_links_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_offerings_reconciled_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_offerings_recorded_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_petty_cash_replenishments_approved_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_petty_cash_replenishments_from_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_petty_cash_replenishments_requested_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_petty_cash_replenishments_to_cash_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledge_campaigns_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledge_campaigns_fund_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledge_contributions_pledge_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledge_contributions_reviewed_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledge_contributions_submitted_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledges_campaign_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_pledges_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_reconciliation_rows_confirmed_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_reconciliation_rows_suggested_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_recurring_entries_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_recurring_entries_credit_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_recurring_entries_debit_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_recurring_entries_fund_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_requests_category_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_requests_department_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_requests_requested_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_finance_requests_reviewed_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_first_timers_converted_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_first_timers_created_by_admin_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_first_timers_created_by_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_first_timers_visited_event_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_follow_up_notes_added_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_follow_up_tasks_assigned_to_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_game_participants_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_game_responses_participant_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_game_responses_question_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_game_sessions_host_admin_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_games_church_class_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_games_created_by_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_games_department_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_group_members_added_by_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_groups_created_by_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_incident_reports_reporter_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_member_import_jobs_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_member_virtual_accounts_deactivated_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_member_virtual_accounts_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_pastor_feedback_responded_by_pastor_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_pastor_feedback_submitted_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_prayer_day_configs_program_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_prayer_fixed_assignments_day_config_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_prayer_meetings_day_config_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_prayer_roster_entries_rescheduled_from_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_prayer_schedule_rules_program_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_pregnancy_prayer_cases_created_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_pregnancy_prayer_visits_logged_by`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_rental_addons_asset_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_rental_booking_addons_addon_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_rental_booking_addons_booking_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_rental_bookings_facility_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_rental_bookings_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_rental_calendar_blocks_facility_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_rental_payments_booking_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_request_leave_actioned_by`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sermon_notes_member_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sermons_created_by_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_action_entries_performed_by_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_headcounts_recorded_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_programme_slots_backup_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_programme_slots_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_programme_templates_created_from_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_programmes_created_by_admin_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_ratings_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_ratings_service_slot_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_session_access_grants_granted_by_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_session_slots_overridden_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_session_slots_programme_slot_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_service_slots_config_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_service_slots_venue_override_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_small_group_attendance_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_small_group_members_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_small_groups_created_by_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_small_groups_leader_id`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_social_accounts_connected_by`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_social_posts_created_by`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_sunday_school_classes_teacher_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_testimonies_prayer_request_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_dispute_records_batch_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_dispute_records_existing_record_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_dispute_records_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_dispute_records_reviewed_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_payment_proofs_reviewed_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_records_virtual_account_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_unmatched_records_batch_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_unmatched_records_matched_member_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_unmatched_records_resolved_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_tithe_upload_batches_uploaded_by`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_volunteer_opportunities_created_by_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_volunteer_opportunities_department_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_volunteer_signups_member_id`,
    );
  }
}
