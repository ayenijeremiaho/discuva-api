import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CampusService } from './campus.service';
import { MemberRoleEnum } from '../member/enums/member-role.enum';
import { Member } from '../member/entity/member.entity';
import { Venue } from '../venue/entity/venue.entity';
import { CampusMoveStatus, MemberCampusMove } from './campus.entity';

describe('CampusService', () => {
  const tx = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn((v) => Promise.resolve({ id: 'new', ...v })),
    create: jest.fn((_e, v) => v),
    update: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
  };
  const manager = { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const campusRepo: any = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    existsBy: jest.fn(),
    manager,
    createQueryBuilder: () => ({
      where: () => ({
        andWhere: () => ({ getExists: () => Promise.resolve(false) }),
      }),
    }),
  };
  const moveRepo: any = {};
  const requestRepo: any = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    manager,
  };
  const memberRepo: any = { findOne: jest.fn(), manager };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const service = new CampusService(
    campusRepo,
    moveRepo,
    requestRepo,
    memberRepo,
    cache as any,
    audit as any,
  );
  const two = [
    { id: 'c1', name: 'North' },
    { id: 'c2', name: 'South' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
    campusRepo.find.mockResolvedValue(two);
    tx.find.mockResolvedValue([]);
  });

  describe('visibility', () => {
    it('offers nothing with fewer than two active campuses', async () => {
      campusRepo.find.mockResolvedValue([two[0]]);
      expect(await service.publicChoices()).toEqual([]);
      expect(await service.forMember('m1')).toEqual({
        enabled: false,
        campuses: [],
      });
      expect(memberRepo.findOne).not.toHaveBeenCalled();
    });

    it('offers choices with two', async () => {
      memberRepo.findOne.mockResolvedValue({ homeCampusId: 'c1' });
      requestRepo.findOne.mockResolvedValue(null);
      expect(await service.forMember('m1')).toEqual({
        enabled: true,
        campuses: two,
        myCampusId: 'c1',
        pendingMoveTo: null,
      });
    });
  });

  describe('moving', () => {
    it('moves a member straight away and records it', async () => {
      memberRepo.findOne.mockResolvedValue({
        homeCampusId: 'c1',
        role: MemberRoleEnum.MEMBER,
      });
      expect(await service.moveMyself('m1', 'c2')).toEqual({ status: 'moved' });
      expect(tx.update).toHaveBeenCalledWith(Member, 'm1', {
        homeCampusId: 'c2',
      });
      expect(tx.create).toHaveBeenCalledWith(MemberCampusMove, {
        memberId: 'm1',
        fromCampusId: 'c1',
        toCampusId: 'c2',
      });
    });

    it('asks for approval when a worker moves, without moving them', async () => {
      memberRepo.findOne.mockResolvedValue({
        homeCampusId: 'c1',
        role: MemberRoleEnum.WORKER,
      });
      expect(await service.moveMyself('m1', 'c2')).toEqual({
        status: 'requested',
      });
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('lets a worker choose a first campus without approval', async () => {
      memberRepo.findOne.mockResolvedValue({
        homeCampusId: null,
        role: MemberRoleEnum.WORKER,
      });
      expect(await service.moveMyself('m1', 'c2')).toEqual({ status: 'moved' });
    });

    it('refuses an inactive or unknown campus', async () => {
      await expect(service.moveMyself('m1', 'nope')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('adding campuses', () => {
    it('puts everyone in the first campus when the second is added', async () => {
      tx.find.mockResolvedValue([{ id: 'c1' }]);
      await service.create({ name: 'South' });
      expect(tx.update).toHaveBeenCalledWith(Member, expect.anything(), {
        homeCampusId: 'c1',
      });
      expect(tx.update).toHaveBeenCalledWith(Venue, expect.anything(), {
        campusId: 'c1',
      });
      expect(cache.del).toHaveBeenCalled();
    });

    it('moves nobody when the first campus is added', async () => {
      await service.create({ name: 'North' });
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('moves nobody when a third is added', async () => {
      tx.find.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      await service.create({ name: 'East' });
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe('closing a campus', () => {
    beforeEach(() => {
      campusRepo.findOneBy.mockResolvedValue({
        id: 'c1',
        name: 'North',
        isActive: true,
      });
    });

    it('needs somewhere for its members to go', async () => {
      tx.find.mockResolvedValue([{ id: 'm1' }]);
      await expect(service.update('c1', { isActive: false })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('moves its members and records each move', async () => {
      tx.find.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
      tx.findOneBy.mockResolvedValue({ id: 'c2', isActive: true });
      await service.update('c1', { isActive: false, moveMembersTo: 'c2' });
      expect(tx.insert).toHaveBeenCalledWith(MemberCampusMove, [
        { memberId: 'm1', fromCampusId: 'c1', toCampusId: 'c2' },
        { memberId: 'm2', fromCampusId: 'c1', toCampusId: 'c2' },
      ]);
    });
  });

  describe('deciding a worker move', () => {
    const pending = {
      id: 'r1',
      memberId: 'm1',
      toCampusId: 'c2',
      status: CampusMoveStatus.PENDING,
    };

    it('moves them on approval', async () => {
      requestRepo.findOneBy.mockResolvedValue(pending);
      tx.findOneOrFail.mockResolvedValue({ homeCampusId: 'c1' });
      await service.decideRequest('r1', true, 'a1');
      expect(tx.update).toHaveBeenCalledWith(Member, 'm1', {
        homeCampusId: 'c2',
      });
    });

    it('leaves them where they are when declined', async () => {
      requestRepo.findOneBy.mockResolvedValue(pending);
      await service.decideRequest('r1', false, 'a1');
      expect(tx.update).not.toHaveBeenCalledWith(
        Member,
        expect.anything(),
        expect.anything(),
      );
    });

    it('stops anyone deciding their own move', async () => {
      requestRepo.findOneBy.mockResolvedValue(pending);
      await expect(service.decideRequest('r1', true, 'm1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('stops a second decision', async () => {
      requestRepo.findOneBy.mockResolvedValue({
        ...pending,
        status: CampusMoveStatus.APPROVED,
      });
      await expect(service.decideRequest('r1', true, 'a1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
