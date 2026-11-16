import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChildCareService } from './child-care.service';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { ChildNoteKind } from '../enums/child-note-kind.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const qb = (result: { one?: unknown; many?: unknown[]; raw?: unknown[] }) => {
  const chain: any = {};
  for (const m of [
    'leftJoinAndSelect',
    'leftJoin',
    'addSelect',
    'select',
    'where',
    'andWhere',
    'orderBy',
  ]) {
    chain[m] = jest.fn(() => chain);
  }
  chain.getOne = jest.fn().mockResolvedValue(result.one ?? null);
  chain.getMany = jest.fn().mockResolvedValue(result.many ?? []);
  chain.getRawMany = jest.fn().mockResolvedValue(result.raw ?? []);
  return chain;
};

const today = new Date();
const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
}).format(today);

function setup() {
  const childRepo: any = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((c) => Promise.resolve(c)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'p1', firstname: 'Grace', lastname: 'Ade' }),
    },
  };
  const guardianRepo: any = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const checkInRepo: any = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const noteRepo: any = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve({ id: 'note-1', ...v })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const children: any = {
    ageFields: jest.fn((d) => ({
      dateOfBirth: d.dateOfBirth,
      ageRange: null,
      ageRangeSetOn: null,
    })),
    computeAgeGroup: jest
      .fn()
      .mockResolvedValue({ ageGroup: null, classGroup: null }),
  };
  const push: any = {
    dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChildCareService(
    childRepo,
    guardianRepo,
    checkInRepo,
    noteRepo,
    children,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as any,
    {
      uploadBuffer: jest
        .fn()
        .mockResolvedValue({ secureUrl: 'https://img/x.jpg' }),
    } as any,
    push,
  );
  return { service, childRepo, guardianRepo, checkInRepo, noteRepo, push };
}

const parent = { id: 'p1' } as any;
const child = {
  id: 'c1',
  firstname: 'Tobi',
  lastname: 'Ade',
  specialNotes: 'Allergic to peanuts',
  awayDate: null,
  awayCollector: null,
  classGroup: { id: 'g', name: 'Preschool' },
};

describe('ChildCareService', () => {
  it("hides a child from anyone who isn't their guardian", async () => {
    const { service, guardianRepo } = setup();
    guardianRepo.findOne.mockResolvedValue(null);
    await expect(service.view(parent, 'c1')).rejects.toThrow(NotFoundException);
  });

  it('shows the pickup code only to a guardian who can collect, while the child is in class', async () => {
    const { service, guardianRepo, childRepo, checkInRepo, noteRepo } = setup();
    childRepo.createQueryBuilder.mockReturnValue(qb({ one: child }));
    checkInRepo.createQueryBuilder.mockReturnValue(
      qb({
        one: {
          id: 'ci1',
          status: ChildCheckInStatusEnum.CHECKED_IN,
          pickupCode: 'A7K3',
          checkedInBy: { firstname: 'Funmi', lastname: 'Lawal' },
          checkedOutBy: null,
        },
      }),
    );
    noteRepo.createQueryBuilder.mockReturnValue(qb({ many: [] }));

    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    const allowed = await service.view(parent, 'c1');
    expect(allowed.today?.pickupCode).toBe('A7K3');
    expect(allowed.today?.receivedBy).toBe('Funmi Lawal');

    guardianRepo.findOne.mockResolvedValue({
      id: 'g2',
      isAuthorizedPickup: false,
    });
    const notAllowed = await service.view(parent, 'c1');
    expect(notAllowed.today?.pickupCode).toBeNull();
  });

  it("shows today's away message and ignores one from another day", async () => {
    const { service, guardianRepo, childRepo, checkInRepo } = setup();
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    checkInRepo.createQueryBuilder.mockReturnValue(qb({}));
    childRepo.createQueryBuilder.mockReturnValue(
      qb({
        one: {
          ...child,
          awayDate: ymd,
          awayCollector: { id: 'g2', fullName: 'Femi Ade' },
          awayMessage: 'Femi collects',
        },
      }),
    );
    expect((await service.view(parent, 'c1')).away).toEqual({
      collectorGuardianId: 'g2',
      collectorName: 'Femi Ade',
      message: 'Femi collects',
    });

    childRepo.createQueryBuilder.mockReturnValue(
      qb({
        one: {
          ...child,
          awayDate: '2020-01-01',
          awayCollector: { id: 'g2', fullName: 'Femi Ade' },
        },
      }),
    );
    expect((await service.view(parent, 'c1')).away).toBeNull();
  });

  it('marks shared teacher notes as seen when a parent opens the child', async () => {
    const { service, guardianRepo, childRepo, checkInRepo, noteRepo } = setup();
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    childRepo.createQueryBuilder.mockReturnValue(qb({ one: child }));
    checkInRepo.createQueryBuilder.mockReturnValue(
      qb({ one: { id: 'ci1', status: ChildCheckInStatusEnum.CHECKED_IN } }),
    );
    noteRepo.createQueryBuilder.mockReturnValue(
      qb({
        many: [
          {
            id: 'n1',
            fromParent: false,
            parentSeenAt: null,
            text: 'Great day',
            author: { id: 't1', firstname: 'Funmi', lastname: 'Lawal' },
          },
          {
            id: 'n2',
            fromParent: true,
            parentSeenAt: null,
            text: 'Thanks',
            author: { id: 'p1' },
          },
        ],
      }),
    );
    const res = await service.view(parent, 'c1');
    expect(noteRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ parentSeenAt: expect.anything() }),
      expect.objectContaining({ parentSeenBy: { id: 'p1' } }),
    );
    expect(res.notes.map((n) => [n.id, n.isNew, n.isMine])).toEqual([
      ['n1', true, false],
      ['n2', false, true],
    ]);
  });

  it('records who changed the special notes, and leaves it alone when they did not change', async () => {
    const { service, guardianRepo, childRepo, checkInRepo } = setup();
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    childRepo.createQueryBuilder.mockReturnValue(qb({ one: child }));
    checkInRepo.createQueryBuilder.mockReturnValue(qb({}));

    childRepo.findOne.mockResolvedValue({ ...child });
    await service.update(parent, 'c1', {
      specialNotes: ['Allergic to peanuts', ' Uses an inhaler '],
    });
    expect(childRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        specialNotes: 'Allergic to peanuts\nUses an inhaler',
        notesUpdatedBy: { id: 'p1' },
        notesUpdatedAt: expect.any(Date),
      }),
    );

    childRepo.findOne.mockResolvedValue({ ...child });
    await service.update(parent, 'c1', {
      specialNotes: ['Allergic to peanuts'],
      doctorName: ' City Clinic ',
    });
    const saved = childRepo.save.mock.calls.at(-1)[0];
    expect(saved.notesUpdatedBy).toBeUndefined();
    expect(saved.doctorName).toBe('City Clinic');
  });

  it("won't name someone who can't collect as today's collector", async () => {
    const { service, guardianRepo } = setup();
    guardianRepo.findOne
      .mockResolvedValueOnce({ id: 'g1', isAuthorizedPickup: true })
      .mockResolvedValueOnce({ id: 'g3', isAuthorizedPickup: false });
    await expect(
      service.setAway(parent, 'c1', { collectorGuardianId: 'g3' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('only lets a parent reply once the child is checked in today', async () => {
    const { service, guardianRepo, checkInRepo } = setup();
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    checkInRepo.findOne.mockResolvedValue(null);
    await expect(service.reply(parent, 'c1', { text: 'Hi' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("sends a parent's reply to the visit's teachers, not back to the parent", async () => {
    const { service, guardianRepo, childRepo, checkInRepo, noteRepo, push } =
      setup();
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    checkInRepo.findOne.mockResolvedValue({
      id: 'ci1',
      child: { id: 'c1', firstname: 'Tobi' },
      checkedInBy: { id: 't1' },
    });
    noteRepo.findOne.mockResolvedValue({ id: 'n1', author: { id: 't2' } });
    noteRepo.createQueryBuilder.mockImplementation(() =>
      qb({ raw: [{ id: 't2' }, { id: 'p1' }], many: [] }),
    );
    childRepo.createQueryBuilder.mockReturnValue(qb({ one: child }));
    checkInRepo.createQueryBuilder.mockReturnValue(qb({}));

    await service.reply(parent, 'c1', { text: 'Thank you for checking!' });

    expect(noteRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fromParent: true,
        kind: ChildNoteKind.PARENT_REPLY,
        replyTo: { id: 'n1' },
      }),
    );
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      ['t1', 't2'],
      expect.objectContaining({
        key: PushNotificationKey.CHILD_NOTE_REPLY,
        vars: expect.objectContaining({
          parent_name: 'Grace Ade',
          child_name: 'Tobi',
        }),
      }),
    );
  });

  it('only accepts images as a photo', async () => {
    const { service, guardianRepo } = setup();
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      isAuthorizedPickup: true,
    });
    await expect(
      service.uploadPhoto(parent, 'c1', {
        mimetype: 'application/pdf',
        buffer: Buffer.from(''),
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
