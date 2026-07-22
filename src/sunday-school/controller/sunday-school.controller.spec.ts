import { Test, TestingModule } from '@nestjs/testing';
import { SundaySchoolController } from './sunday-school.controller';
import { SundaySchoolService } from '../service/sunday-school.service';
import { SundaySchoolAttendanceStatus } from '../enums/sunday-school-attendance-status.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockSundaySchoolService = {
  createClass: jest.fn(),
  updateClass: jest.fn(),
  deleteClass: jest.fn(),
  getAllClasses: jest.fn(),
  getClass: jest.fn(),
  assignMember: jest.fn(),
  removeMember: jest.fn(),
  getClassMembers: jest.fn(),
  getSessionsForClass: jest.fn(),
  createSession: jest.fn(),
  openSelfMark: jest.fn(),
  closeSelfMark: jest.fn(),
  selfMarkPresent: jest.fn(),
  bulkMarkAttendance: jest.fn(),
  getSessionRoster: jest.fn(),
  getSession: jest.fn(),
  deleteSession: jest.fn(),
  getOpenSessionsForMember: jest.fn(),
  getMyAttendanceHistory: jest.fn(),
};

const mockUser = {
  id: 'worker-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const mockReq = { user: mockUser };

describe('SundaySchoolController', () => {
  let controller: SundaySchoolController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SundaySchoolController],
      providers: [
        { provide: SundaySchoolService, useValue: mockSundaySchoolService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleEnabledGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SundaySchoolController>(SundaySchoolController);
  });

  it('createClass — passes req.user and dto to service', async () => {
    const dto = { name: 'Beginners' };
    mockSundaySchoolService.createClass.mockResolvedValue({
      id: 'class-1',
      ...dto,
    });

    await controller.createClass(mockReq, dto as any);

    expect(mockSundaySchoolService.createClass).toHaveBeenCalledWith(
      mockUser,
      dto,
    );
  });

  it('updateClass — passes req.user, id, and dto', async () => {
    const dto = { name: 'Advanced' };
    mockSundaySchoolService.updateClass.mockResolvedValue({
      id: 'class-1',
      ...dto,
    });

    await controller.updateClass(mockReq, 'class-1', dto as any);

    expect(mockSundaySchoolService.updateClass).toHaveBeenCalledWith(
      mockUser,
      'class-1',
      dto,
    );
  });

  it('deleteClass — calls service with id only (no user — ADMIN-only via guard)', async () => {
    mockSundaySchoolService.deleteClass.mockResolvedValue(undefined);

    await controller.deleteClass('class-1');

    expect(mockSundaySchoolService.deleteClass).toHaveBeenCalledWith('class-1');
  });

  it('getAllClasses — coerces query strings to numbers', async () => {
    mockSundaySchoolService.getAllClasses.mockResolvedValue({
      data: [],
      totalCount: 0,
      page: 2,
      limit: 10,
      totalPages: 0,
    });

    await controller.getAllClasses(2, 10);

    expect(mockSundaySchoolService.getAllClasses).toHaveBeenCalledWith(2, 10);
  });

  it('getClass — passes id to service', async () => {
    mockSundaySchoolService.getClass.mockResolvedValue({ id: 'class-1' });

    await controller.getClass('class-1');

    expect(mockSundaySchoolService.getClass).toHaveBeenCalledWith('class-1');
  });

  it('assignMember — passes req.user, classId, and dto', async () => {
    const dto = { memberId: 'member-1' };
    mockSundaySchoolService.assignMember.mockResolvedValue({ id: 'assign-1' });

    await controller.assignMember(mockReq, 'class-1', dto as any);

    expect(mockSundaySchoolService.assignMember).toHaveBeenCalledWith(
      mockUser,
      'class-1',
      dto,
    );
  });

  it('removeMember — passes req.user, classId, and memberId', async () => {
    mockSundaySchoolService.removeMember.mockResolvedValue(undefined);

    await controller.removeMember(mockReq, 'class-1', 'member-1');

    expect(mockSundaySchoolService.removeMember).toHaveBeenCalledWith(
      mockUser,
      'class-1',
      'member-1',
    );
  });

  it('getClassMembers — coerces page and limit', async () => {
    mockSundaySchoolService.getClassMembers.mockResolvedValue({
      data: [],
      totalCount: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    await controller.getClassMembers('class-1', 1, 20);

    expect(mockSundaySchoolService.getClassMembers).toHaveBeenCalledWith(
      'class-1',
      1,
      20,
    );
  });

  it('createSession — passes req.user and dto', async () => {
    const dto = { classId: 'class-1', sessionDate: '2026-06-08' };
    mockSundaySchoolService.createSession.mockResolvedValue({
      id: 'session-1',
    });

    await controller.createSession(mockReq, dto as any);

    expect(mockSundaySchoolService.createSession).toHaveBeenCalledWith(
      mockUser,
      dto,
    );
  });

  it('openSelfMark — passes req.user, session id, and closesInMinutes', async () => {
    const closesAt = new Date(Date.now() + 30 * 60 * 1000);
    mockSundaySchoolService.openSelfMark.mockResolvedValue({
      id: 'session-1',
      selfMarkClosesAt: closesAt,
    });

    await controller.openSelfMark(mockReq, 'session-1', {
      closesInMinutes: 30,
    } as any);

    expect(mockSundaySchoolService.openSelfMark).toHaveBeenCalledWith(
      mockUser,
      'session-1',
      30,
    );
  });

  it('closeSelfMark — passes req.user and session id', async () => {
    mockSundaySchoolService.closeSelfMark.mockResolvedValue({
      id: 'session-1',
      selfMarkClosesAt: null,
    });

    await controller.closeSelfMark(mockReq, 'session-1');

    expect(mockSundaySchoolService.closeSelfMark).toHaveBeenCalledWith(
      mockUser,
      'session-1',
    );
  });

  it('getOpenSessions — passes req.user to service', async () => {
    mockSundaySchoolService.getOpenSessionsForMember.mockResolvedValue([]);

    await controller.getOpenSessions(mockReq);

    expect(
      mockSundaySchoolService.getOpenSessionsForMember,
    ).toHaveBeenCalledWith(mockUser);
  });

  it('getMyAttendanceHistory — coerces page and limit, passes req.user', async () => {
    mockSundaySchoolService.getMyAttendanceHistory.mockResolvedValue({
      data: [],
      totalCount: 0,
    });

    await controller.getMyAttendanceHistory(mockReq, 1, 20);

    expect(mockSundaySchoolService.getMyAttendanceHistory).toHaveBeenCalledWith(
      mockUser,
      1,
      20,
    );
  });

  it('selfMarkPresent — passes req.user and session id', async () => {
    mockSundaySchoolService.selfMarkPresent.mockResolvedValue({ id: 'att-1' });

    await controller.selfMarkPresent(mockReq, 'session-1');

    expect(mockSundaySchoolService.selfMarkPresent).toHaveBeenCalledWith(
      mockUser,
      'session-1',
    );
  });

  it('bulkMarkAttendance — passes req.user, session id, and dto', async () => {
    const dto = {
      attendances: [
        { memberId: 'member-1', status: SundaySchoolAttendanceStatus.PRESENT },
      ],
    };
    mockSundaySchoolService.bulkMarkAttendance.mockResolvedValue([
      { id: 'att-1' },
    ]);

    await controller.bulkMarkAttendance(mockReq, 'session-1', dto as any);

    expect(mockSundaySchoolService.bulkMarkAttendance).toHaveBeenCalledWith(
      mockUser,
      'session-1',
      dto,
    );
  });

  it('getSessionRoster — passes req.user and session id', async () => {
    mockSundaySchoolService.getSessionRoster.mockResolvedValue({
      sessionId: 'session-1',
      members: [],
    });

    await controller.getSessionRoster(mockReq, 'session-1');

    expect(mockSundaySchoolService.getSessionRoster).toHaveBeenCalledWith(
      mockUser,
      'session-1',
    );
  });
});
