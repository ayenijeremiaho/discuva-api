import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { GroupService } from './group.service';
import { Group } from '../entity/group.entity';
import { GroupMember } from '../entity/group-member.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

const mockAuditLogService = { log: jest.fn() };

const makeQb = () => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  loadRelationCountAndMap: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getOne: jest.fn(),
  getManyAndCount: jest.fn(),
  getRawMany: jest.fn(),
});

const mockGroupRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockGroupMemberRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

describe('GroupService', () => {
  let service: GroupService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        { provide: getRepositoryToken(Group), useValue: mockGroupRepo },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: mockGroupMemberRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
  });

  describe('getLookup', () => {
    it('returns id/name pairs ordered by name', async () => {
      const groups = [{ id: 'g-1', name: 'Call Leaders' }];
      mockGroupRepo.find.mockResolvedValue(groups);

      const result = await service.getLookup();

      expect(mockGroupRepo.find).toHaveBeenCalledWith({
        select: ['id', 'name'],
        order: { name: 'ASC' },
      });
      expect(result).toEqual(groups);
    });
  });

  describe('create', () => {
    it('should throw ConflictException if a group with the same name already exists', async () => {
      mockGroupRepo.findOne.mockResolvedValue({
        id: 'g-1',
        name: 'Call Leaders',
      });

      await expect(
        service.create({ name: 'Call Leaders' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should create and save a new group', async () => {
      mockGroupRepo.findOne.mockResolvedValue(null);
      const group = { id: 'g-1', name: 'Call Leaders', description: null };
      mockGroupRepo.create.mockReturnValue(group);
      mockGroupRepo.save.mockResolvedValue(group);

      const result = await service.create({ name: 'Call Leaders' }, 'admin-1');

      expect(mockGroupRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Call Leaders',
          createdBy: { id: 'admin-1' },
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GROUP_CREATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'g-1' }),
      );
      expect(result).toEqual(group);
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException if group does not exist', async () => {
      mockGroupRepo.findOne.mockResolvedValue(null);

      await expect(service.delete('missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should remove the group when found', async () => {
      const group = { id: 'g-1', name: 'Call Leaders' };
      mockGroupRepo.findOne.mockResolvedValue(group);
      mockGroupRepo.remove.mockResolvedValue(undefined);

      await service.delete('g-1', 'admin-1');

      expect(mockGroupRepo.remove).toHaveBeenCalledWith(group);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GROUP_DELETED',
        expect.objectContaining({ targetId: 'g-1' }),
      );
    });
  });

  describe('addMember', () => {
    it('should throw ConflictException if member is already in the group', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'g-1' });
      mockGroupMemberRepo.findOne.mockResolvedValue({ id: 'gm-1' });

      await expect(
        service.addMember('g-1', { memberId: 'm-1' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should add a member to the group', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'g-1' });
      mockGroupMemberRepo.findOne.mockResolvedValue(null);
      const groupMember = {
        id: 'gm-1',
        group: { id: 'g-1' },
        member: { id: 'm-1' },
      };
      mockGroupMemberRepo.create.mockReturnValue(groupMember);
      mockGroupMemberRepo.save.mockResolvedValue(groupMember);

      const result = await service.addMember(
        'g-1',
        { memberId: 'm-1' },
        'admin-1',
      );

      expect(result).toEqual(groupMember);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GROUP_MEMBERS_ADDED',
        expect.objectContaining({ targetId: 'g-1' }),
      );
    });
  });

  describe('bulkAddMembers', () => {
    it('should tally added and skipped counts', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'g-1' });
      mockGroupMemberRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' });
      mockGroupMemberRepo.create.mockReturnValue({ id: 'gm-1' });
      mockGroupMemberRepo.save.mockResolvedValue({ id: 'gm-1' });

      const result = await service.bulkAddMembers(
        'g-1',
        { memberIds: ['m-1', 'm-2'] },
        'admin-1',
      );

      expect(result).toEqual({ added: 1, skipped: 1 });
    });
  });

  describe('removeMember', () => {
    it('should throw NotFoundException if member is not in the group', async () => {
      mockGroupMemberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeMember('g-1', 'm-1', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should remove the member from the group', async () => {
      const groupMember = { id: 'gm-1' };
      mockGroupMemberRepo.findOne.mockResolvedValue(groupMember);
      mockGroupMemberRepo.remove.mockResolvedValue(undefined);

      await service.removeMember('g-1', 'm-1', 'admin-1');

      expect(mockGroupMemberRepo.remove).toHaveBeenCalledWith(groupMember);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GROUP_MEMBERS_REMOVED',
        expect.objectContaining({
          targetId: 'g-1',
          metadata: { memberIds: ['m-1'] },
        }),
      );
    });
  });

  describe('bulkRemoveMembers', () => {
    it('should delete matching rows and report the removed count', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'g-1' });
      mockGroupMemberRepo.delete.mockResolvedValue({ affected: 2 });

      const result = await service.bulkRemoveMembers(
        'g-1',
        { memberIds: ['m-1', 'm-2'] },
        'admin-1',
      );

      expect(result).toEqual({ removed: 2 });
    });
  });

  describe('getMemberIdsForGroup', () => {
    it('should return the flat list of member ids in the group', async () => {
      const qb = makeQb();
      qb.getRawMany.mockResolvedValue([
        { memberId: 'm-1' },
        { memberId: 'm-2' },
      ]);
      mockGroupMemberRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMemberIdsForGroup('g-1');

      expect(result).toEqual(['m-1', 'm-2']);
    });
  });

  describe('getMembers', () => {
    it('should return a paginated roster', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'g-1' });
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[{ id: 'gm-1' }], 1]);
      mockGroupMemberRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [{ id: 'gm-1' } as any],
        page: 1,
        limit: 20,
        totalCount: 1,
        totalPages: 1,
      });

      const result = await service.getMembers('g-1', 1, 20);

      expect(result.totalCount).toBe(1);
    });
  });
});
