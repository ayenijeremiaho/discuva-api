export class WorkerDashboardDataDto {
  profile: any;
  isDepartmentLead: boolean;
  departmentLeadDetails?: {
    departmentAttendancePercentage: number;
    totalDepartmentPendingLeaveRequests: number;
  };
  ledDepartments?: {
    departmentId: string;
    name: string;
    attendanceRate: number;
    workerCount: number;
    pendingLeaveRequests: number;
  }[];
  personalAttendancePercentage: number;
  attendanceStreak: number;
  rank: number;
  periodStats: {
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    total: number;
  };
  recentAttendance: any[];
  upcomingEvents: any[];
  totalPendingLeaveRequests: number;
}
