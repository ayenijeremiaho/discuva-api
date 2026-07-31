import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SmallGroupService } from './small-group.service';
import { SmallGroup } from '../entity/small-group.entity';
import { SmallGroupMember } from '../entity/small-group-member.entity';
import { SmallGroupAttendance } from '../entity/small-group-attendance.entity';
import { SmallGroupAttendanceStatusEnum } from '../enum/small-group-attendance-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockGroupRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockAttendanceRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockAdmin = { id: 'admin-1' } as any;

describe('SmallGroupService', () => {
  let service: SmallGroupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmallGroupService,
        { provide: getRepositoryToken(SmallGroup), useValue: mockGroupRepo },
        {
          provide: getRepositoryToken(SmallGroupMember),
          useValue: mockMemberRepo,
        },
        {
          provide: getRepositoryToken(SmallGroupAttendance),
          useValue: mockAttendanceRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<SmallGroupService>(SmallGroupService);
  });

  describe('create', () => {
    it('creates a group and logs SMALL_GROUP_CREATED', async () => {
      const saved = { id: 'group-1', name: 'Cell 1' };
      mockGroupRepo.create.mockReturnValue(saved);
      mockGroupRepo.save.mockResolvedValue(saved);

      const result = await service.create({ name: 'Cell 1' }, mockAdmin);

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SMALL_GROUP_CREATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'group-1' }),
      );
      expect(result).toBe(saved);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the group does not exist', async () => {
      mockGroupRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { name: 'X' }, mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('unlinks the leader when leaderId is explicitly null', async () => {
      mockGroupRepo.findOne.mockResolvedValue({
        id: 'group-1',
        leader: { id: 'member-1' },
      });
      mockGroupRepo.save.mockImplementation((g) => Promise.resolve(g));

      const result = await service.update(
        'group-1',
        { leaderId: null } as any,
        mockAdmin,
      );

      expect(result.leader).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the group and logs SMALL_GROUP_DELETED', async () => {
      const group = { id: 'group-1', name: 'Cell 1' };
      mockGroupRepo.findOne.mockResolvedValue(group);

      await service.delete('group-1', mockAdmin);

      expect(mockGroupRepo.remove).toHaveBeenCalledWith(group);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SMALL_GROUP_DELETED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'group-1' }),
      );
    });
  });

  describe('list', () => {
    it('throws BadRequestException when page is less than 1', async () => {
      await expect(service.list(0)).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeMember', () => {
    it('throws NotFoundException when the membership does not exist', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeMember('group-1', 'member-1', mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes the membership and logs SMALL_GROUP_MEMBER_REMOVED', async () => {
      const membership = { id: 'sgm-1' };
      mockMemberRepo.findOne.mockResolvedValue(membership);

      await service.removeMember('group-1', 'member-1', mockAdmin);

      expect(mockMemberRepo.remove).toHaveBeenCalledWith(membership);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SMALL_GROUP_MEMBER_REMOVED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'group-1' }),
      );
    });
  });

  describe('join', () => {
    it('throws NotFoundException when the group does not exist', async () => {
      mockGroupRepo.findOne.mockResolvedValue(null);
      await expect(service.join('missing', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the existing membership instead of creating a duplicate', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1' });
      const existing = { id: 'sgm-1' };
      mockMemberRepo.findOne.mockResolvedValue(existing);

      const result = await service.join('group-1', 'member-1');

      expect(mockMemberRepo.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a new membership when none exists', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1' });
      mockMemberRepo.findOne.mockResolvedValue(null);
      const created = { id: 'sgm-1' };
      mockMemberRepo.create.mockReturnValue(created);
      mockMemberRepo.save.mockResolvedValue(created);

      const result = await service.join('group-1', 'member-1');

      expect(result).toBe(created);
    });

    it('returns the now-existing membership instead of a 500 when a concurrent join races past the initial check', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1' });
      const created = { id: 'sgm-1' };
      mockMemberRepo.findOne
        .mockResolvedValueOnce(null) // initial check: no membership yet
        .mockResolvedValueOnce(created); // re-fetch after the unique-violation catch
      mockMemberRepo.create.mockReturnValue(created);
      mockMemberRepo.save.mockRejectedValue({ code: '23505' });

      const result = await service.join('group-1', 'member-1');

      expect(result).toBe(created);
    });

    it('rethrows a save error that is not a unique violation', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1' });
      mockMemberRepo.findOne.mockResolvedValue(null);
      mockMemberRepo.create.mockReturnValue({ id: 'sgm-1' });
      mockMemberRepo.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.join('group-1', 'member-1')).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('leave', () => {
    it('throws NotFoundException when the member is not in the group', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(service.leave('group-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the membership', async () => {
      const membership = { id: 'sgm-1' };
      mockMemberRepo.findOne.mockResolvedValue(membership);

      await service.leave('group-1', 'member-1');

      expect(mockMemberRepo.remove).toHaveBeenCalledWith(membership);
    });
  });

  describe('getMembers', () => {
    it('throws ForbiddenException when the requester is not a group member or its leader', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1', leader: null });
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(service.getMembers('group-1', 'member-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the roster when the requester is a group member', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1', leader: null });
      mockMemberRepo.findOne.mockResolvedValue({ id: 'sgm-1' });
      const roster = [{ id: 'sgm-1' }, { id: 'sgm-2' }];
      mockMemberRepo.find.mockResolvedValue(roster);

      const result = await service.getMembers('group-1', 'member-1');

      expect(result).toBe(roster);
    });

    it('returns the roster for the group leader even without a separate membership row', async () => {
      // create()/update() only set `leader` on the group — they never insert
      // a SmallGroupMember row for them, so membership alone can't be the
      // only path to viewing the roster.
      mockGroupRepo.findOne.mockResolvedValue({
        id: 'group-1',
        leader: { id: 'leader-1' },
      });
      mockMemberRepo.findOne.mockResolvedValue(null);
      const roster = [{ id: 'sgm-1' }];
      mockMemberRepo.find.mockResolvedValue(roster);

      const result = await service.getMembers('group-1', 'leader-1');

      expect(result).toBe(roster);
    });
  });

  describe('getRoster', () => {
    it('returns a paginated roster', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1' });
      const roster = [{ id: 'sgm-1' }, { id: 'sgm-2' }];
      mockMemberRepo.findAndCount.mockResolvedValue([roster, 2]);

      const result = await service.getRoster('group-1', 2, 10);

      expect(mockMemberRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result).toEqual({
        data: roster,
        page: 2,
        limit: 10,
        totalCount: 2,
        totalPages: 1,
      });
    });
  });

  describe('getAttendanceHistory', () => {
    it('returns paginated attendance history', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1' });
      const history = [{ id: 'att-1' }];
      mockAttendanceRepo.findAndCount.mockResolvedValue([history, 1]);

      const result = await service.getAttendanceHistory('group-1', 1, 20);

      expect(mockAttendanceRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result).toEqual({
        data: history,
        page: 1,
        limit: 20,
        totalCount: 1,
        totalPages: 1,
      });
    });
  });

  describe('recordAttendance', () => {
    it('throws ForbiddenException when the caller is not the group leader', async () => {
      mockGroupRepo.findOne.mockResolvedValue({
        id: 'group-1',
        leader: { id: 'someone-else' },
      });

      await expect(
        service.recordAttendance('group-1', 'member-1', {
          meetingDate: '2026-06-15',
          records: [
            {
              memberId: 'member-1',
              status: SmallGroupAttendanceStatusEnum.PRESENT,
            },
          ],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the group has no leader assigned', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'group-1', leader: null });

      await expect(
        service.recordAttendance('group-1', 'member-1', {
          meetingDate: '2026-06-15',
          records: [],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates new attendance rows for the leader', async () => {
      mockGroupRepo.findOne.mockResolvedValue({
        id: 'group-1',
        leader: { id: 'leader-1' },
      });
      mockAttendanceRepo.findOne.mockResolvedValue(null);
      mockAttendanceRepo.create.mockImplementation((data) => data);
      mockAttendanceRepo.save.mockImplementation((data) =>
        Promise.resolve({ id: 'att-1', ...data }),
      );

      const result = await service.recordAttendance('group-1', 'leader-1', {
        meetingDate: '2026-06-15',
        records: [
          {
            memberId: 'member-1',
            status: SmallGroupAttendanceStatusEnum.PRESENT,
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(SmallGroupAttendanceStatusEnum.PRESENT);
    });

    it('edits an existing attendance row in place for the same meeting date instead of duplicating', async () => {
      mockGroupRepo.findOne.mockResolvedValue({
        id: 'group-1',
        leader: { id: 'leader-1' },
      });
      const existing = {
        id: 'att-1',
        status: SmallGroupAttendanceStatusEnum.ABSENT,
      };
      mockAttendanceRepo.findOne.mockResolvedValue(existing);
      mockAttendanceRepo.save.mockImplementation((data) =>
        Promise.resolve(data),
      );

      const result = await service.recordAttendance('group-1', 'leader-1', {
        meetingDate: '2026-06-15',
        records: [
          {
            memberId: 'member-1',
            status: SmallGroupAttendanceStatusEnum.PRESENT,
          },
        ],
      });

      expect(mockAttendanceRepo.create).not.toHaveBeenCalled();
      expect(result[0].status).toBe(SmallGroupAttendanceStatusEnum.PRESENT);
    });
  });
});
