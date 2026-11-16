import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChildCheckInNoteService } from './child-checkin-note.service';
import { ChildNoteKind } from '../enums/child-note-kind.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const chain = (result: {
  one?: unknown;
  many?: unknown[];
  raw?: unknown[];
}) => {
  const c: any = {};
  for (const m of [
    'innerJoinAndSelect',
    'leftJoinAndSelect',
    'leftJoin',
    'addSelect',
    'select',
    'where',
    'andWhere',
    'orderBy',
  ]) {
    c[m] = jest.fn(() => c);
  }
  c.getOne = jest.fn().mockResolvedValue(result.one ?? null);
  c.getMany = jest.fn().mockResolvedValue(result.many ?? []);
  c.getRawMany = jest.fn().mockResolvedValue(result.raw ?? []);
  return c;
};

function setup() {
  const checkInRepo: any = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const noteRepo: any = {
    createQueryBuilder: jest.fn(() => chain({ many: [] })),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve({ id: 'n1', ...v })),
    manager: {
      findOne: jest
        .fn()
        .mockResolvedValue({ firstname: 'Funmi', lastname: 'Lawal' }),
    },
  };
  const guardianRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() =>
      chain({ raw: [{ id: 'p1' }, { id: 'p2' }] }),
    ),
  };
  const access: any = {
    assertHasCapability: jest.fn().mockResolvedValue(undefined),
  };
  const push: any = {
    dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChildCheckInNoteService(
    checkInRepo,
    noteRepo,
    guardianRepo,
    access,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as any,
    push,
  );
  return { service, checkInRepo, noteRepo, guardianRepo, access, push };
}

const teacher = { id: 't1' } as any;
const flush = () => new Promise((r) => setImmediate(r));

describe('ChildCheckInNoteService', () => {
  it("keeps notes to the Children's Church team", async () => {
    const { service, access } = setup();
    access.assertHasCapability.mockRejectedValue(new ForbiddenException());
    await expect(
      service.add(teacher, 'ci1', { kind: ChildNoteKind.FEEDBACK, text: 'Hi' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('shares a note with every guardian on the app and tells them', async () => {
    const { service, checkInRepo, noteRepo, push } = setup();
    checkInRepo.findOne.mockResolvedValue({
      id: 'ci1',
      child: { id: 'c1', firstname: 'Tobi' },
    });
    await service.add(teacher, 'ci1', {
      kind: ChildNoteKind.FEEDBACK,
      text: 'Said the memory verse',
    });
    await flush();
    expect(noteRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ sharedWithParents: true }),
    );
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      ['p1', 'p2'],
      expect.objectContaining({
        key: PushNotificationKey.CHILD_NOTE_SHARED,
        vars: {
          child_name: 'Tobi',
          teacher_name: 'Funmi Lawal',
          note: 'Said the memory verse',
        },
      }),
    );
  });

  it('never shares a team-only note, even if asked to', async () => {
    const { service, checkInRepo, noteRepo, push } = setup();
    checkInRepo.findOne.mockResolvedValue({
      id: 'ci1',
      child: { id: 'c1', firstname: 'Tobi' },
    });
    await service.add(teacher, 'ci1', {
      kind: ChildNoteKind.TEAM_ONLY,
      text: 'Teary at drop-off',
      shareWithParents: true,
    });
    await flush();
    expect(noteRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ sharedWithParents: false }),
    );
    expect(push.dispatchToMemberIds).not.toHaveBeenCalled();
  });

  it('lets the teacher keep a feedback note to the team', async () => {
    const { service, checkInRepo, push } = setup();
    checkInRepo.findOne.mockResolvedValue({
      id: 'ci1',
      child: { id: 'c1', firstname: 'Tobi' },
    });
    await service.add(teacher, 'ci1', {
      kind: ChildNoteKind.MEAL,
      text: 'Ate well',
      shareWithParents: false,
    });
    await flush();
    expect(push.dispatchToMemberIds).not.toHaveBeenCalled();
  });

  it("shows the team who received the child, today's away message and family contacts", async () => {
    const { service, checkInRepo } = setup();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
    }).format(new Date());
    checkInRepo.createQueryBuilder.mockReturnValue(
      chain({
        one: {
          id: 'ci1',
          status: 'CHECKED_IN',
          pickupCode: 'A7K3',
          checkedInBy: { firstname: 'Funmi', lastname: 'Lawal' },
          droppedOffBy: { fullName: 'Adaeze Okafor', relationship: 'MOTHER' },
          child: {
            id: 'c1',
            firstname: 'Tobi',
            lastname: 'Ade',
            emergencyContactName: 'Kemi Adebayo',
            awayDate: ymd,
            awayCollector: { fullName: 'Femi Ade', relationship: 'FATHER' },
            awayMessage: 'Femi collects today',
          },
        },
      }),
    );
    const d = await service.detail(teacher, 'ci1');
    expect(d.receivedBy).toBe('Funmi Lawal');
    expect(d.droppedOffBy).toEqual({
      name: 'Adaeze Okafor',
      relationship: 'MOTHER',
    });
    expect(d.child.emergencyContactName).toBe('Kemi Adebayo');
    expect(d.away).toEqual({
      collectorName: 'Femi Ade',
      collectorRelationship: 'FATHER',
      message: 'Femi collects today',
    });
  });

  it('404s an unknown check-in', async () => {
    const { service, checkInRepo } = setup();
    checkInRepo.createQueryBuilder.mockReturnValue(chain({}));
    await expect(service.detail(teacher, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});
