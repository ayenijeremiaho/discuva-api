import { Injectable, Logger } from '@nestjs/common';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberService } from '../../member/service/member.service';
import {
  AttendanceService,
  MyAttendanceSummary,
} from '../../attendance/service/attendance.service';
import { EventService } from '../../event/service/event.service';
import { DepartmentService } from '../../department/service/department.service';
import { RequestLeaveService } from '../../request-leave/service/request-leave.service';
import { ClassesService } from '../../classes/service/classes.service';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminService } from '../../admin/service/admin.service';
import { CacheService } from '../../utility/service/cache.service';
import { AdminDashboardDataDto } from '../dto/admin-dashboard-data.dto';
import { WorkerDashboardDataDto } from '../dto/worker-dashboard-data.dto';
import { MemberDashboardDataDto } from '../dto/member-dashboard-data.dto';

const ADMIN_DASHBOARD_TTL = 300;

// My Stats reads the same summary as the Attendance tab, so both pages always show the same rate and counts.
function dashboardAttendance(summary: MyAttendanceSummary) {
  return {
    personalAttendancePercentage: summary.attendanceRatePercentage,
    attendanceStreak: summary.attendanceStreak,
    periodStats: {
      // Present = on time, in person or online; late is counted on its own.
      present: summary.presentCount - summary.lateCount,
      late: summary.lateCount,
      absent: summary.absentCount,
      onLeave: summary.onLeaveCount,
      total: summary.totalCount + summary.onLeaveCount,
    },
  };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly memberService: MemberService,
    private readonly attendanceService: AttendanceService,
    private readonly eventService: EventService,
    private readonly departmentService: DepartmentService,
    private readonly requestLeaveService: RequestLeaveService,
    private readonly classesService: ClassesService,
    private readonly adminService: AdminService,
    private readonly cacheService: CacheService,
  ) {}

  async getMemberDashboard(
    user: MemberAuth,
    daysAgo = 30,
  ): Promise<MemberDashboardDataDto> {
    this.logger.log(`Fetching member dashboard for member ${user.id}`);

    const [
      profile,
      summary,
      rank,
      recentAttendance,
      upcomingEvents,
      enrollments,
    ] = await Promise.all([
      this.memberService.getById(user.id),
      this.attendanceService.getMyAttendanceSummary(
        user.id,
        MemberRoleEnum.MEMBER,
        daysAgo,
      ),
      this.attendanceService.getMemberRank(
        user.id,
        daysAgo,
        MemberRoleEnum.MEMBER,
      ),
      this.attendanceService.getMyHistory(user, 1, 5),
      this.eventService.getUpcomingEvents(5, { id: user.id, isWorker: false }),
      this.classesService.getMyEnrollments(user.id),
    ]);

    return {
      profile,
      ...dashboardAttendance(summary),
      rank,
      recentAttendance: recentAttendance.data,
      upcomingEvents,
      enrollments,
    };
  }

  async getWorkerDashboard(
    user: MemberAuth,
    daysAgo = 30,
  ): Promise<WorkerDashboardDataDto> {
    this.logger.log(`Fetching worker dashboard for worker ${user.id}`);

    const [
      profile,
      summary,
      rank,
      recentAttendance,
      upcomingEvents,
      ledDepartments,
    ] = await Promise.all([
      this.memberService.getById(user.id, [
        'workerProfile',
        'workerProfile.department',
      ]),
      this.attendanceService.getMyAttendanceSummary(
        user.id,
        MemberRoleEnum.WORKER,
        daysAgo,
      ),
      this.attendanceService.getMemberRank(
        user.id,
        daysAgo,
        MemberRoleEnum.WORKER,
      ),
      this.attendanceService.getMyHistory(user, 1, 5),
      this.eventService.getUpcomingEvents(5, { id: user.id, isWorker: true }),
      this.departmentService.getLedDepartments(user.id),
    ]);
    const isDepartmentLead = ledDepartments.length > 0;

    const workerProfileId = profile.workerProfile?.id ?? null;
    const totalPendingLeaveRequests = workerProfileId
      ? await this.requestLeaveService.countPendingLeave(workerProfileId)
      : 0;

    const result: WorkerDashboardDataDto = {
      profile,
      isDepartmentLead,
      ...dashboardAttendance(summary),
      rank,
      recentAttendance: recentAttendance.data,
      upcomingEvents,
      totalPendingLeaveRequests,
    };

    if (isDepartmentLead) {
      const ids = ledDepartments.map((d) => d.id);
      const [rates, pending] = await Promise.all([
        this.attendanceService.getDepartmentAttendanceRates(ids, daysAgo),
        this.requestLeaveService.countPendingLeaveByDepartments(ids),
      ]);
      result.ledDepartments = ledDepartments.map((d) => ({
        departmentId: d.id,
        name: d.name,
        attendanceRate: rates.get(d.id)?.rate ?? 0,
        workerCount: rates.get(d.id)?.workerCount ?? 0,
        pendingLeaveRequests: pending.get(d.id) ?? 0,
      }));
      // Older app versions read this single summary; it's now the first led department, on the same rule.
      const first = result.ledDepartments[0];
      result.departmentLeadDetails = {
        departmentAttendancePercentage: first.attendanceRate,
        totalDepartmentPendingLeaveRequests: first.pendingLeaveRequests,
      };
    }

    return result;
  }

  async getAdminDashboard(daysAgo = 30): Promise<AdminDashboardDataDto> {
    this.logger.log('Fetching admin dashboard');
    return this.cacheService.getOrSet(
      `dashboard:admin:${daysAgo}`,
      () => this.fetchAdminDashboard(daysAgo),
      ADMIN_DASHBOARD_TTL,
    );
  }

  private async fetchAdminDashboard(
    daysAgo: number,
  ): Promise<AdminDashboardDataDto> {
    const [
      totalMembers,
      totalWorkers,
      totalAdmins,
      totalCheckInsToday,
      workerAttendancePercentage,
      congregationAttendancePercentage,
      weeklyAttendanceTrend,
      newMemberRegistrationsTrend,
      departmentAttendanceSummary,
      topAbsentWorkers,
      membersNotSeenRecently,
      upcomingEvents,
      totalPendingLeaveRequests,
      totalActiveEnrollments,
      classEnrollmentBreakdown,
      classCompletionsTrend,
    ] = await Promise.all([
      this.memberService.count({ where: { role: MemberRoleEnum.MEMBER } }),
      this.memberService.count({ where: { role: MemberRoleEnum.WORKER } }),
      this.adminService.countActive(),
      this.attendanceService.getTotalCheckInsToday(),
      this.attendanceService.getWorkerAttendancePercentage(daysAgo),
      this.attendanceService.getCongregationAttendancePercentage(daysAgo),
      this.attendanceService.getWeeklyAttendanceTrend(daysAgo),
      this.attendanceService.getNewMemberRegistrationsTrend(daysAgo),
      this.attendanceService.getDepartmentAttendanceSummary(daysAgo),
      this.attendanceService.getTopAbsentMembers(
        daysAgo,
        10,
        MemberRoleEnum.WORKER,
      ),
      this.attendanceService.getMembersNotSeenSince(daysAgo, 20),
      this.eventService.getUpcomingEvents(5),
      this.requestLeaveService.countPendingLeave(),
      this.classesService.countActiveEnrollments(),
      this.classesService.getClassEnrollmentBreakdown(),
      this.classesService.getClassCompletionsTrend(daysAgo),
    ]);

    return {
      totalMembers,
      totalWorkers,
      totalAdmins,
      totalCheckInsToday,
      workerAttendancePercentage,
      congregationAttendancePercentage,
      weeklyAttendanceTrend,
      newMemberRegistrationsTrend,
      departmentAttendanceSummary,
      topAbsentWorkers,
      membersNotSeenRecently,
      upcomingEvents,
      totalPendingLeaveRequests,
      totalActiveEnrollments,
      classEnrollmentBreakdown,
      classCompletionsTrend,
    };
  }
}
