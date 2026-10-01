import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClassJoinRequestService } from './class-join-request.service';
import { ClassJoinRequestStatusEnum as R } from '../enum/class-join-request-status.enum';
import { EnrollmentStatusEnum as E } from '../enum/enrollment-status.enum';

describe('ClassJoinRequestService', () => {
  const requestRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    exists: jest.fn(),
    save: jest.fn((v) => Promise.resolve(v)),
    create: jest.fn((v) => v),
    createQueryBuilder: jest.fn(),
  };
  const classRepo = { findOne: jest.fn() };
  const enrollmentRepo = { findOne: jest.fn(), count: jest.fn() };
  const classesService = { enrollMember: jest.fn() };
  const notifications = { notifyMember: jest.fn() };
  const service = new ClassJoinRequestService(
    requestRepo as any,
    classRepo as any,
    enrollmentRepo as any,
    classesService as any,
    notifications as any,
  );
  const open = {
    id: 'c1',
    name: "Believers' Class",
    status: 'ACTIVE',
    openForRequests: true,
    capacity: 20,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    classRepo.findOne.mockResolvedValue(open);
    enrollmentRepo.findOne.mockResolvedValue(null);
    enrollmentRepo.count.mockResolvedValue(5);
    requestRepo.exists.mockResolvedValue(false);
    notifications.notifyMember.mockResolvedValue(undefined);
  });

  it('lets a member ask to join an open class with places left', async () => {
    await service.request('c1', 'm1', '  I was baptised last month ');
    expect(requestRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        churchClass: open,
        member: { id: 'm1' },
        message: 'I was baptised last month',
      }),
    );
  });

  it("refuses when the class isn't taking requests, is full, closed, or they're already in it", async () => {
    classRepo.findOne.mockResolvedValueOnce({
      ...open,
      openForRequests: false,
    });
    await expect(service.request('c1', 'm1')).rejects.toThrow(
      ForbiddenException,
    );

    enrollmentRepo.count.mockResolvedValueOnce(20);
    await expect(service.request('c1', 'm1')).rejects.toThrow(/is full/);

    classRepo.findOne.mockResolvedValueOnce({ ...open, status: 'CLOSED' });
    await expect(service.request('c1', 'm1')).rejects.toThrow(
      BadRequestException,
    );

    enrollmentRepo.findOne.mockResolvedValueOnce({ status: E.IN_PROGRESS });
    await expect(service.request('c1', 'm1')).rejects.toThrow(
      "You're already in this class.",
    );

    requestRepo.exists.mockResolvedValueOnce(true);
    await expect(service.request('c1', 'm1')).rejects.toThrow(
      ConflictException,
    );
    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('a cancelled enrolment can ask again', async () => {
    enrollmentRepo.findOne.mockResolvedValue({ status: E.CANCELLED });
    await expect(service.request('c1', 'm1')).resolves.toBeDefined();
  });

  it('approving enrols the member and tells them', async () => {
    const pending = {
      id: 'r1',
      status: R.PENDING,
      churchClass: open,
      member: { id: 'm1' },
    };
    requestRepo.findOne.mockResolvedValue(pending);
    classesService.enrollMember.mockResolvedValue({ id: 'e1' });

    await expect(service.approve('r1', 'admin-1')).resolves.toEqual({
      id: 'e1',
    });

    expect(classesService.enrollMember).toHaveBeenCalledWith({
      classId: 'c1',
      memberId: 'm1',
    });
    expect(pending).toMatchObject({
      status: R.APPROVED,
      decidedByAdmin: { id: 'admin-1' },
    });
    expect(notifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'TRAINING_CLASSES',
        push: expect.objectContaining({
          memberIds: ['m1'],
          key: 'CLASS_JOIN_APPROVED',
          vars: { class_name: open.name },
        }),
      }),
    );
  });

  it('declining records the reason and tells them; decided requests stay decided', async () => {
    const pending = {
      id: 'r1',
      status: R.PENDING,
      churchClass: open,
      member: { id: 'm1' },
    };
    requestRepo.findOne.mockResolvedValue(pending);
    await service.decline('r1', 'admin-1', ' Next intake starts in January ');
    expect(pending).toMatchObject({
      status: R.DECLINED,
      declineReason: 'Next intake starts in January',
    });
    expect(notifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({ key: 'CLASS_JOIN_DECLINED' }),
      }),
    );

    await expect(service.approve('r1', 'admin-1')).rejects.toThrow(
      /already been decided/,
    );
  });

  it('a member can only withdraw their own pending request', async () => {
    requestRepo.findOne.mockResolvedValue({
      id: 'r1',
      status: R.PENDING,
      member: { id: 'someone-else' },
    });
    await expect(service.withdraw('r1', 'm1')).rejects.toThrow(
      NotFoundException,
    );

    const mine = { id: 'r1', status: R.PENDING, member: { id: 'm1' } };
    requestRepo.findOne.mockResolvedValue(mine);
    await service.withdraw('r1', 'm1');
    expect(mine.status).toBe(R.WITHDRAWN);
  });

  it('tells the member where they stand on a class', async () => {
    enrollmentRepo.count.mockResolvedValue(18);
    requestRepo.findOne.mockResolvedValue({
      id: 'r1',
      status: R.PENDING,
      createdAt: new Date('2026-10-01'),
      declineReason: null,
    });

    await expect(service.joinStatus('c1', 'm1')).resolves.toEqual({
      openForRequests: true,
      classClosed: false,
      capacity: 20,
      spotsLeft: 2,
      enrollmentStatus: null,
      enrollmentId: null,
      request: {
        id: 'r1',
        status: R.PENDING,
        createdAt: new Date('2026-10-01'),
        declineReason: null,
      },
    });
  });
});
