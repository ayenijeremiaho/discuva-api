import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { toEnumOptions } from '../utility/types/enum-option.type';
import {
  AnnouncementAudienceEnum,
  AnnouncementAudienceLabels,
} from '../announcement/enum/announcement-audience.enum';
import {
  AttendanceStatusEnum,
  AttendanceStatusLabels,
} from '../attendance/enums/check-in.enum';
import {
  ChildCheckInStatusEnum,
  ChildCheckInStatusLabels,
} from '../children-church/enums/child-checkin-status.enum';
import {
  GuardianRelationshipEnum,
  GuardianRelationshipLabels,
} from '../children-church/enums/guardian-relationship.enum';
import {
  EnrollmentStatusEnum,
  EnrollmentStatusLabels,
} from '../classes/enum/enrollment-status.enum';
import {
  DepartmentCapability,
  DepartmentCapabilityLabels,
} from '../department/enums/department-capability.enum';
import {
  DepartmentLeadTypeEnum,
  DepartmentLeadTypeLabels,
} from '../department/enums/department-lead-type.enum';
import {
  ReminderIntervalPresetEnum,
  ReminderIntervalPresetLabels,
} from '../event/enum/reminder-interval-preset.enum';
import {
  EventRecurrencePatternEnum,
  EventRecurrencePatternLabels,
} from '../event/enums/event-recurrence-patterns.enums';
import { GenderEnum, GenderLabels } from '../member/enums/gender.enum';
import {
  MaritalStatusEnum,
  MaritalStatusLabels,
} from '../member/enums/marital-status.enum';
import {
  MemberRoleEnum,
  MemberRoleLabels,
} from '../member/enums/member-role.enum';
import {
  MemberStatusEnum,
  MemberStatusLabels,
} from '../member/enums/member-status.enum';
import {
  WorkerStatusEnum,
  WorkerStatusLabels,
} from '../member/enums/worker-status.enum';
import { NoteTypeEnum, NoteTypeLabels } from '../notes/enums/note-type.enums';
import {
  LeaveStatusEnum,
  LeaveStatusLabels,
} from '../request-leave/enums/leave-status.enum';
import {
  SundaySchoolAttendanceStatus,
  SundaySchoolAttendanceStatusLabels,
} from '../sunday-school/enums/sunday-school-attendance-status.enum';
import { AdminPermissionGroups } from '../admin/enum/admin-permission.enum';
import { CurrencyCode, CurrencyCodeLabels } from '../tithe/enum/tithe.enum';
import {
  ServiceProgrammeStatusEnum,
  ServiceProgrammeStatusLabels,
} from '../service-programme/enum/service-programme-status.enum';
import {
  ServiceSlotTypeEnum,
  ServiceSlotTypeLabels,
} from '../service-programme/enum/service-slot-type.enum';
import {
  ServiceSessionStatusEnum,
  ServiceSessionStatusLabels,
} from '../service-programme/enum/service-session-status.enum';
import {
  ServiceSessionSlotStatusEnum,
  ServiceSessionSlotStatusLabels,
} from '../service-programme/enum/service-session-slot-status.enum';
import {
  ServicePauseReasonEnum,
  ServicePauseReasonLabels,
} from '../service-programme/enum/service-pause-reason.enum';
import {
  ServiceActionRoleEnum,
  ServiceActionRoleLabels,
} from '../service-programme/enum/service-action-role.enum';

@UseGuards(JwtAuthGuard)
@Controller('enums')
export class EnumsController {
  @Get()
  getAll() {
    return {
      announcementAudiences: toEnumOptions(
        AnnouncementAudienceEnum,
        AnnouncementAudienceLabels,
      ),
      attendanceStatuses: toEnumOptions(
        AttendanceStatusEnum,
        AttendanceStatusLabels,
      ),
      childCheckInStatuses: toEnumOptions(
        ChildCheckInStatusEnum,
        ChildCheckInStatusLabels,
      ),
      guardianRelationships: toEnumOptions(
        GuardianRelationshipEnum,
        GuardianRelationshipLabels,
      ),
      enrollmentStatuses: toEnumOptions(
        EnrollmentStatusEnum,
        EnrollmentStatusLabels,
      ),
      departmentCapabilities: toEnumOptions(
        DepartmentCapability,
        DepartmentCapabilityLabels,
      ),
      departmentLeadTypes: toEnumOptions(
        DepartmentLeadTypeEnum,
        DepartmentLeadTypeLabels,
      ),
      reminderIntervals: toEnumOptions(
        ReminderIntervalPresetEnum,
        ReminderIntervalPresetLabels,
      ),
      eventRecurrencePatterns: toEnumOptions(
        EventRecurrencePatternEnum,
        EventRecurrencePatternLabels,
      ),
      genders: toEnumOptions(GenderEnum, GenderLabels),
      maritalStatuses: toEnumOptions(MaritalStatusEnum, MaritalStatusLabels),
      memberRoles: toEnumOptions(MemberRoleEnum, MemberRoleLabels),
      memberStatuses: toEnumOptions(MemberStatusEnum, MemberStatusLabels),
      workerStatuses: toEnumOptions(WorkerStatusEnum, WorkerStatusLabels),
      noteTypes: toEnumOptions(NoteTypeEnum, NoteTypeLabels),
      leaveStatuses: toEnumOptions(LeaveStatusEnum, LeaveStatusLabels),
      ssAttendanceStatuses: toEnumOptions(
        SundaySchoolAttendanceStatus,
        SundaySchoolAttendanceStatusLabels,
      ),
      serviceProgrammeStatuses: toEnumOptions(
        ServiceProgrammeStatusEnum,
        ServiceProgrammeStatusLabels,
      ),
      serviceSlotTypes: toEnumOptions(
        ServiceSlotTypeEnum,
        ServiceSlotTypeLabels,
      ),
      serviceSessionStatuses: toEnumOptions(
        ServiceSessionStatusEnum,
        ServiceSessionStatusLabels,
      ),
      serviceSessionSlotStatuses: toEnumOptions(
        ServiceSessionSlotStatusEnum,
        ServiceSessionSlotStatusLabels,
      ),
      servicePauseReasons: toEnumOptions(
        ServicePauseReasonEnum,
        ServicePauseReasonLabels,
      ),
      serviceActionRoles: toEnumOptions(
        ServiceActionRoleEnum,
        ServiceActionRoleLabels,
      ),
      currencies: toEnumOptions(CurrencyCode, CurrencyCodeLabels),
      adminPermissionGroups: AdminPermissionGroups,
    };
  }
}
