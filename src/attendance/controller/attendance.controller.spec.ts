import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from '../service/attendance.service';
import { AttendanceSettingsService } from '../service/attendance-settings.service';
import { BlockedCheckinService } from '../service/blocked-checkin.service';
import { LocationFlagService } from '../service/location-flag.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';

const mockAttendanceService = {
  getAllHistory: jest.fn(),
  undoCheckin: jest.fn().mockResolvedValue({}),
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

const mockLocationFlagService = {
  verify: jest.fn().mockResolvedValue({
    locationFlags: [],
    compared: true,
    repeatedAt: [],
    sharedWith: [],
  }),
};

const mockBlockedCheckinService = {
  list: jest.fn().mockResolvedValue({
    data: [],
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 1,
  }),
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
        { provide: BlockedCheckinService, useValue: mockBlockedCheckinService },
        { provide: LocationFlagService, useValue: mockLocationFlagService },
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

      const result = await controller.getMySummary(
        { user: { id: 'member-1', role: 'MEMBER' } } as any,
        {},
      );

      expect(mockAttendanceService.getMyAttendanceSummary).toHaveBeenCalledWith(
        'member-1',
        'MEMBER',
        undefined,
      );
      expect(result).toEqual(summary);
    });

    it('passes a days window through', async () => {
      mockAttendanceService.getMyAttendanceSummary.mockResolvedValue({});
      await controller.getMySummary(
        { user: { id: 'member-1', role: 'MEMBER' } } as any,
        { days: 30 },
      );
      expect(mockAttendanceService.getMyAttendanceSummary).toHaveBeenCalledWith(
        'member-1',
        'MEMBER',
        30,
      );
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
        undefined,
        undefined,
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
        role: MemberRoleEnum.WORKER,
        flagged: true,
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
        MemberRoleEnum.WORKER,
        true,
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

    it('getMyEnforceDistanceCheck (member-readable) delegates to the same AttendanceSettingsService.getConfig', async () => {
      mockAttendanceSettingsService.getConfig.mockResolvedValue({
        enabled: true,
        isPlatformDefault: false,
      });

      const result = await controller.getMyEnforceDistanceCheck();

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

  describe('getBlockedCheckins', () => {
    it('passes paging and the event filter to the service', async () => {
      await controller.getBlockedCheckins({
        page: 2,
        limit: 10,
        eventId: 'e1',
      });
      expect(mockBlockedCheckinService.list).toHaveBeenCalledWith(2, 10, 'e1');
    });
  });

  describe('verifyLocation', () => {
    it('verifies the given check-in on request', async () => {
      await controller.verifyLocation('att-1');
      expect(mockLocationFlagService.verify).toHaveBeenCalledWith('att-1');
    });
  });

  describe('undoCheckin', () => {
    it('passes the reason and the acting admin to the service', async () => {
      await controller.undoCheckin('att-1', { reason: 'Location faked' }, {
        member: { id: 'admin-member-1' },
      } as any);
      expect(mockAttendanceService.undoCheckin).toHaveBeenCalledWith(
        'att-1',
        'Location faked',
        'admin-member-1',
      );
    });
  });
});
