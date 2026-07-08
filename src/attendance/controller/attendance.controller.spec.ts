import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from '../service/attendance.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { AttendanceStatusEnum } from '../enums/check-in.enum';

const mockAttendanceService = {
  getAllHistory: jest.fn(),
  getMyHistory: jest.fn(),
  checkin: jest.fn(),
  correctAttendance: jest.fn(),
  getSlotSummary: jest.fn(),
  getWorkerLeaderboard: jest.fn(),
  getDepartmentHistory: jest.fn(),
  getDepartmentEventAttendance: jest.fn(),
  confirmOnlineAttendance: jest.fn(),
};

describe('AttendanceController', () => {
  let controller: AttendanceController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        { provide: AttendanceService, useValue: mockAttendanceService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
});
