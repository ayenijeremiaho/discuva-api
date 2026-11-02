import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CampusService } from './campus.service';
import { MemberRoleEnum } from '../member/enums/member-role.enum';
import { Member } from '../member/entity/member.entity';
import { Venue } from '../venue/entity/venue.entity';
import {
  CampusAdmin,
  CampusMoveStatus,
  MemberCampusMove,
  WorkerCampusMoveRequest,
} from './campus.entity';

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
  const manager = {
    transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    count: jest.fn(),
  };
  let nameClash = false;
  const campusRepo: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    existsBy: jest.fn(),
    manager,
    createQueryBuilder: () => ({
      where: () => ({
        andWhere: () => ({ getExists: () => Promise.resolve(nameClash) }),
      }),
    }),
  };
  const moveQb: any = {};
  for (const m of [
    'leftJoin',
    'select',
    'orderBy',
    'offset',
    'limit',
    'where',
  ]) {
    moveQb[m] = jest.fn(() => moveQb);
  }
  moveQb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  const moveRepo: any = { createQueryBuilder: () => moveQb };
  const requestRepo: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    manager,
  };
  const memberRepo: any = { findOne: jest.fn(), count: jest.fn(), manager };
  const campusAdminRepo: any = { find: jest.fn(), manager };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const notifier = {
    moveRequested: jest.fn().mockResolvedValue(undefined),
    moveDecided: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CampusService(
    campusRepo,
    moveRepo,
    requestRepo,
    memberRepo,
    campusAdminRepo,
    cache as any,
    audit as any,
    notifier as any,
  );
  const two = [
    { id: 'c1', name: 'North' },
    { id: 'c2', name: 'South' },
  ];
  const churchWide = { id: 'a1', isOwner: false, member: { id: 'am1' } };

  beforeEach(() => {
    jest.clearAllMocks();
    nameClash = false;
    cache.get.mockResolvedValue(undefined);
    campusRepo.find.mockResolvedValue(two);
    campusAdminRepo.find.mockResolvedValue([]);
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
    });

    it('offers choices with two', async () => {
      memberRepo.findOne.mockResolvedValue({ id: 'm1', homeCampusId: 'c1' });
      requestRepo.findOne.mockResolvedValue({ id: 'r1', toCampusId: 'c2' });
      expect(await service.forMember('m1')).toEqual({
        enabled: true,
        campuses: two,
        myCampusId: 'c1',
        pendingMoveTo: 'c2',
      });
    });

    it('uses the cached list without touching the database', async () => {
      cache.get.mockResolvedValue(two);
      expect(await service.publicChoices()).toEqual(two);
      expect(campusRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('moving', () => {
    it('moves a member straight away and records it', async () => {
      memberRepo.findOne.mockResolvedValue({
        id: 'm1',
        homeCampusId: 'c1',
        role: MemberRoleEnum.MEMBER,
      });
      expect(await service.moveMyself('m1', 'c2')).toEqual({
        status: 'moved',
      });
      expect(tx.update).toHaveBeenCalledWith(Member, 'm1', {
        homeCampusId: 'c2',
      });
      expect(tx.create).toHaveBeenCalledWith(MemberCampusMove, {
        memberId: 'm1',
        fromCampusId: 'c1',
        toCampusId: 'c2',
      });
    });

    it('asks for approval when a worker moves, and tells the right people', async () => {
      memberRepo.findOne.mockResolvedValue({
        id: 'm1',
        homeCampusId: 'c1',
        role: MemberRoleEnum.WORKER,
      });
      campusRepo.findOne.mockResolvedValue({ id: 'c1', name: 'North' });
      expect(await service.moveMyself('m1', 'c2')).toEqual({
        status: 'requested',
      });
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.delete).toHaveBeenCalledWith(WorkerCampusMoveRequest, {
        memberId: 'm1',
        status: CampusMoveStatus.PENDING,
      });
      expect(notifier.moveRequested).toHaveBeenCalledWith({
        requestId: 'new',
        memberId: 'm1',
        fromCampus: { id: 'c1', name: 'North' },
        toCampus: { id: 'c2', name: 'South' },
      });
    });

    it('lets a worker choose a first campus without approval', async () => {
      memberRepo.findOne.mockResolvedValue({
        id: 'm1',
        homeCampusId: null,
        role: MemberRoleEnum.WORKER,
      });
      expect(await service.moveMyself('m1', 'c2')).toEqual({
        status: 'moved',
      });
      expect(notifier.moveRequested).not.toHaveBeenCalled();
    });

    it('withdraws a pending request when they choose where they already are', async () => {
      memberRepo.findOne.mockResolvedValue({
        id: 'm1',
        homeCampusId: 'c1',
        role: MemberRoleEnum.WORKER,
      });
      expect(await service.moveMyself('m1', 'c1')).toEqual({
        status: 'unchanged',
      });
      expect(requestRepo.delete).toHaveBeenCalledWith({
        memberId: 'm1',
        status: CampusMoveStatus.PENDING,
      });
    });

    it('refuses an inactive or unknown campus', async () => {
      await expect(service.moveMyself('m1', 'gone')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses everything while only one campus is open', async () => {
      campusRepo.find.mockResolvedValue([two[0]]);
      await expect(service.moveMyself('m1', 'c1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('adding campuses', () => {
    it('puts everyone in the first campus when the second is added', async () => {
      tx.find.mockResolvedValue([{ id: 'c1', isActive: true }]);
      await service.create({ name: 'South' }, 'a1');
      expect(tx.update).toHaveBeenCalledWith(
        Member,
        { homeCampusId: expect.anything() },
        { homeCampusId: 'c1' },
      );
      expect(tx.update).toHaveBeenCalledWith(
        Venue,
        { campusId: expect.anything() },
        { campusId: 'c1' },
      );
      expect(cache.del).toHaveBeenCalledWith('campuses:active');
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

    it('refuses a name already used, whatever the case', async () => {
      nameClash = true;
      await expect(service.create({ name: 'north' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reopening a campus', () => {
    it('places people who joined meanwhile, as choosing starts again', async () => {
      campusRepo.findOneBy.mockResolvedValue({
        id: 'c2',
        name: 'South',
        isActive: false,
      });
      tx.find.mockResolvedValue([{ id: 'c1', isActive: true }]);
      await service.update('c2', { isActive: true });
      expect(tx.update).toHaveBeenCalledWith(
        Member,
        { homeCampusId: expect.anything() },
        { homeCampusId: 'c1' },
      );
      expect(tx.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c2', isActive: true }),
      );
    });

    it('moves nobody when other campuses were already open', async () => {
      campusRepo.findOneBy.mockResolvedValue({ id: 'c3', isActive: false });
      tx.find.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      await service.update('c3', { isActive: true });
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

    it('refuses to send them to itself or a closed campus', async () => {
      tx.find.mockResolvedValue([{ id: 'm1' }]);
      tx.findOneBy.mockResolvedValue(null);
      await expect(
        service.update('c1', { isActive: false, moveMembersTo: 'c9' }),
      ).rejects.toThrow(BadRequestException);
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

    it('drops requests the close already granted', async () => {
      tx.find.mockResolvedValue([{ id: 'm1' }]);
      tx.findOneBy.mockResolvedValue({ id: 'c2', isActive: true });
      await service.update('c1', { isActive: false, moveMembersTo: 'c2' });
      expect(tx.delete).toHaveBeenCalledWith(WorkerCampusMoveRequest, {
        fromCampusId: 'c1',
        toCampusId: 'c2',
        status: CampusMoveStatus.PENDING,
      });
    });

    it('closes an empty campus without a destination', async () => {
      await service.update('c1', { isActive: false });
      expect(tx.delete).toHaveBeenCalledWith(WorkerCampusMoveRequest, {
        toCampusId: 'c1',
        status: CampusMoveStatus.PENDING,
      });
      expect(tx.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    it('refuses an unknown campus', async () => {
      campusRepo.findOneBy.mockResolvedValue(null);
      await expect(service.update('x', { name: 'A' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('venues and admins', () => {
    it('clears the venue list cache', async () => {
      campusRepo.existsBy.mockResolvedValue(true);
      await service.setVenues('c1', ['v1']);
      expect(cache.del).toHaveBeenCalledWith('venues:all');
    });

    it('replaces the campus admins', async () => {
      campusRepo.existsBy.mockResolvedValue(true);
      manager.count.mockResolvedValue(2);
      await service.setAdmins('c1', ['a1', 'a2', 'a1'], 'am1');
      expect(tx.delete).toHaveBeenCalledWith(CampusAdmin, { campusId: 'c1' });
      expect(tx.insert).toHaveBeenCalledWith(CampusAdmin, [
        { campusId: 'c1', adminId: 'a1' },
        { campusId: 'c1', adminId: 'a2' },
      ]);
    });

    it('refuses inactive or unknown admins', async () => {
      campusRepo.existsBy.mockResolvedValue(true);
      manager.count.mockResolvedValue(1);
      await expect(service.setAdmins('c1', ['a1', 'gone'])).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('admin moving a member', () => {
    it('moves them and drops any request', async () => {
      memberRepo.findOne.mockResolvedValue({ id: 'm1', homeCampusId: 'c1' });
      expect(await service.moveMember('m1', 'c2', churchWide)).toEqual({
        status: 'moved',
      });
      expect(tx.delete).toHaveBeenCalledWith(WorkerCampusMoveRequest, {
        memberId: 'm1',
        status: CampusMoveStatus.PENDING,
      });
      expect(tx.update).toHaveBeenCalledWith(Member, 'm1', {
        homeCampusId: 'c2',
      });
    });

    it("stops another campus's admin", async () => {
      memberRepo.findOne.mockResolvedValue({ id: 'm1', homeCampusId: 'c1' });
      campusAdminRepo.find.mockResolvedValue([{ campusId: 'c2' }]);
      await expect(service.moveMember('m1', 'c2', churchWide)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deciding a worker move', () => {
    const pending = {
      id: 'r1',
      memberId: 'm1',
      fromCampusId: 'c1',
      toCampusId: 'c2',
      fromCampus: { id: 'c1', name: 'North' },
      toCampus: { id: 'c2', name: 'South' },
      status: CampusMoveStatus.PENDING,
    };

    beforeEach(() => requestRepo.findOne.mockResolvedValue(pending));

    it('moves them on approval and tells everyone', async () => {
      tx.findOneOrFail.mockResolvedValue({ homeCampusId: 'c1' });
      await service.decideRequest('r1', true, churchWide);
      expect(tx.update).toHaveBeenCalledWith(Member, 'm1', {
        homeCampusId: 'c2',
      });
      expect(notifier.moveDecided).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'r1', memberId: 'm1' }),
        true,
      );
    });

    it('lets the current campus admins decide', async () => {
      campusAdminRepo.find.mockResolvedValue([{ campusId: 'c1' }]);
      tx.findOneOrFail.mockResolvedValue({ homeCampusId: 'c1' });
      await expect(
        service.decideRequest('r1', true, churchWide),
      ).resolves.toEqual({ status: CampusMoveStatus.APPROVED });
    });

    it("stops the new campus's admins deciding", async () => {
      campusAdminRepo.find.mockResolvedValue([{ campusId: 'c2' }]);
      await expect(
        service.decideRequest('r1', true, churchWide),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets an owner decide whatever their campuses', async () => {
      campusAdminRepo.find.mockResolvedValue([{ campusId: 'c2' }]);
      tx.findOneOrFail.mockResolvedValue({ homeCampusId: 'c1' });
      await expect(
        service.decideRequest('r1', true, { ...churchWide, isOwner: true }),
      ).resolves.toEqual({ status: CampusMoveStatus.APPROVED });
    });

    it('records no move when they are already there', async () => {
      tx.findOneOrFail.mockResolvedValue({ homeCampusId: 'c2' });
      await service.decideRequest('r1', true, churchWide);
      expect(tx.save).not.toHaveBeenCalled();
    });

    it('leaves them where they are when declined', async () => {
      await service.decideRequest('r1', false, churchWide);
      expect(tx.update).not.toHaveBeenCalledWith(
        Member,
        expect.anything(),
        expect.anything(),
      );
      expect(notifier.moveDecided).toHaveBeenCalledWith(
        expect.anything(),
        false,
      );
    });

    it('stops anyone deciding their own move', async () => {
      await expect(
        service.decideRequest('r1', true, {
          ...churchWide,
          member: { id: 'm1' },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('stops a second decision', async () => {
      requestRepo.findOne.mockResolvedValue({
        ...pending,
        status: CampusMoveStatus.APPROVED,
      });
      await expect(
        service.decideRequest('r1', true, churchWide),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listing', () => {
    it('marks which requests this admin may decide', async () => {
      campusAdminRepo.find.mockResolvedValue([{ campusId: 'c1' }]);
      requestRepo.find.mockResolvedValue([
        { id: 'r1', fromCampusId: 'c1', member: { id: 'm1' } },
        { id: 'r2', fromCampusId: 'c2', member: { id: 'm2' } },
        { id: 'r3', fromCampusId: 'c1', member: { id: 'am1' } },
      ]);
      const rows = await service.moveRequests(churchWide);
      expect(rows.map((r) => r.canDecide)).toEqual([true, false, false]);
    });

    it('filters moves by campus and direction', async () => {
      await service.moves({
        campusId: 'c1',
        direction: 'left',
        page: 2,
        limit: 10,
      });
      expect(moveQb.where).toHaveBeenCalledWith(
        'move.fromCampusId = :campusId',
        expect.objectContaining({ campusId: 'c1' }),
      );
      expect(moveQb.offset).toHaveBeenCalledWith(10);
      expect(moveQb.limit).toHaveBeenCalledWith(10);
    });

    it('counts members without a campus only while choosing is on', async () => {
      const qb: any = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        andWhere: () => qb,
        groupBy: () => qb,
        getRawMany: () => Promise.resolve([{ campusId: 'c1', count: '3' }]),
      };
      memberRepo.createQueryBuilder = () => qb;
      const venueQb: any = {
        select: () => venueQb,
        addSelect: () => venueQb,
        where: () => venueQb,
        groupBy: () => venueQb,
        getRawMany: () => Promise.resolve([]),
      };
      (manager as any).createQueryBuilder = () => venueQb;
      requestRepo.count.mockResolvedValue(1);
      memberRepo.count.mockResolvedValue(4);
      campusRepo.find.mockResolvedValue([
        { id: 'c1', name: 'North', isActive: true },
      ]);
      const one = await service.listForAdmin();
      expect(one.withoutCampus).toBe(0);
      expect(one.campuses[0]).toMatchObject({ members: 3, venues: 0 });

      campusRepo.find.mockResolvedValue([
        { id: 'c1', name: 'North', isActive: true },
        { id: 'c2', name: 'South', isActive: true },
      ]);
      expect((await service.listForAdmin()).withoutCampus).toBe(4);
    });
  });
});
