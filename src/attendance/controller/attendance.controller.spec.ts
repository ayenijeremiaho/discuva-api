import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from '../service/attendance.service';
import { AttendanceSettingsService } from '../service/attendance-settings.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { AttendanceStatusEnum } from '../enums/check-in.enum';

const mockAttendanceService = {
  getAllHistory: jest.fn(),
  getMyHistory: jest.fn(),
  getMyAttendanceSummary: jest.fn(),
  checkin: jest.fn(),
  correctAttendance: jest.fn(),
  getSlotSummary: jest.fn(),
  getWorkerLeaderboard: jest.fn(),
  getDepartmentHistory: jest.fn(),
  getDepartmentEventAttendance: jest.fn(),
  confirmOnlineAttendance: jest.fn(),
};

const mockAttendanceSettingsService = {
  getConfig: jest.fn(),
  setEnabled: jest.fn(),
};

describe('AttendanceController', () => {
  let controller: AttendanceController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        { provide: AttendanceService, useValue: mockAttendanceService },
        {
          provide: AttendanceSettingsService,
          useValue: mockAttendanceSettingsService,
        },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlanGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMySummary', () => {
    it('passes the authenticated member id and role to the service', async () => {
      const summary = {
        totalCount: 10,
        presentCount: 9,
        attendanceRatePercentage: 90,
        lastCheckedInDate: null,
        attendanceStreak: 3,
      };
      mockAttendanceService.getMyAttendanceSummary.mockResolvedValue(summary);

      const result = await controller.getMySummary({
        user: { id: 'member-1', role: 'MEMBER' },
      } as any);

      expect(mockAttendanceService.getMyAttendanceSummary).toHaveBeenCalledWith(
        'member-1',
        'MEMBER',
      );
      expect(result).toEqual(summary);
    });
  });

  describe('getAllHistory', () => {
    it('should call service with default pagination when no query params given', async () => {
      mockAttendanceService.getAllHistory.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await controller.getAllHistory({
        page: 1,
        limit: 10,
      } as any);

      expect(mockAttendanceService.getAllHistory).toHaveBeenCalledWith(
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('should pass search param to service', async () => {
      mockAttendanceService.getAllHistory.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await controller.getAllHistory({
        page: 1,
        limit: 10,
        search: 'john',
      } as any);

      expect(mockAttendanceService.getAllHistory).toHaveBeenCalledWith(
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'john',
      );
    });

    it('should pass all filters through to service', async () => {
      mockAttendanceService.getAllHistory.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await controller.getAllHistory({
        page: 2,
        limit: 20,
        memberId: 'member-1',
        slotId: 'slot-1',
        status: AttendanceStatusEnum.PRESENT,
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
        search: 'doe',
      } as any);

      expect(mockAttendanceService.getAllHistory).toHaveBeenCalledWith(
        2,
        20,
        'member-1',
        'slot-1',
        AttendanceStatusEnum.PRESENT,
        '2026-01-01',
        '2026-06-30',
        'doe',
      );
    });

    it('should pass undefined search when not provided in query', async () => {
      mockAttendanceService.getAllHistory.mockResolvedValue({
        data: [],
        totalCount: 0,
      });

      await controller.getAllHistory({
        page: 1,
        limit: 10,
        memberId: 'member-1',
      } as any);

      const call = mockAttendanceService.getAllHistory.mock.calls[0];
      expect(call[7]).toBeUndefined();
    });
  });

  describe('distance-check settings', () => {
    it('getEnforceDistanceCheck delegates to AttendanceSettingsService.getConfig', async () => {
      mockAttendanceSettingsService.getConfig.mockResolvedValue({
        enabled: true,
        isPlatformDefault: false,
      });

      const result = await controller.getEnforceDistanceCheck();

      expect(result).toEqual({ enabled: true, isPlatformDefault: false });
      expect(mockAttendanceSettingsService.getConfig).toHaveBeenCalled();
    });

    it('updateEnforceDistanceCheck delegates to AttendanceSettingsService.setEnabled with the acting member id', async () => {
      mockAttendanceSettingsService.setEnabled.mockResolvedValue({
        enabled: false,
        isPlatformDefault: false,
      });
      const admin = { member: { id: 'member-1' } } as any;

      const result = await controller.updateEnforceDistanceCheck(
        { enabled: false },
        admin,
      );

      expect(mockAttendanceSettingsService.setEnabled).toHaveBeenCalledWith(
        false,
        'member-1',
      );
      expect(result).toEqual({ enabled: false, isPlatformDefault: false });
    });
  });
});
