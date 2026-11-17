import { LatePickupProcessor } from './late-pickup.processor';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const chain = (result: unknown[]) => {
  const c: any = {};
  for (const m of [
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orWhere',
    'orderBy',
  ])
    c[m] = jest.fn((arg: unknown) => {
      if (arg && typeof arg === 'object' && 'whereFactory' in (arg as any))
        (arg as any).whereFactory(c);
      return c;
    });
  c.getMany = jest.fn().mockResolvedValue(result);
  c.getRawMany = jest.fn().mockResolvedValue(result);
  return c;
};

function setup(
  waiting: unknown[],
  guardians: unknown[] = [],
  eventSlots: unknown[] = [],
) {
  const cq = chain(waiting);
  const checkInRepo: any = {
    createQueryBuilder: jest.fn(() => cq),
    update: jest.fn().mockResolvedValue({ affected: waiting.length }),
  };
  const gq = chain(guardians);
  const guardianRepo: any = { createQueryBuilder: jest.fn(() => gq) };
  const slotRepo: any = {
    createQueryBuilder: jest.fn(() => chain(eventSlots)),
  };
  const push: any = {
    dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new LatePickupProcessor(
    checkInRepo,
    guardianRepo,
    slotRepo,
    push,
    {} as any,
    {} as any,
  );
  return { processor, checkInRepo, push, gq, cq };
}

describe('LatePickupProcessor', () => {
  it('does nothing when every child has been collected', async () => {
    const { processor, checkInRepo, push } = setup([]);
    expect(await processor.notify('slot-1')).toBe(0);
    expect(checkInRepo.update).not.toHaveBeenCalled();
    expect(push.dispatchToMemberIds).not.toHaveBeenCalled();
  });

  it('after an earlier service, leaves out children staying for every service', async () => {
    const { processor, cq } = setup(
      [],
      [],
      [
        { id: 'slot-2', endTime: new Date() },
        { id: 'slot-1', endTime: new Date() },
      ],
    );
    await processor.notify('slot-1');
    expect(cq.where).toHaveBeenCalledWith(
      '(ci.service_slot_id = :slotId AND ci.staying_all_services = false)',
      { slotId: 'slot-1' },
    );
    expect(cq.orWhere).not.toHaveBeenCalled();
  });

  it("after the event's last service, also reminds children who stayed for every service", async () => {
    const { processor, cq } = setup(
      [],
      [],
      [
        { id: 'slot-2', endTime: new Date() },
        { id: 'slot-1', endTime: new Date() },
      ],
    );
    await processor.notify('slot-2');
    expect(cq.orWhere).toHaveBeenCalledWith(
      '(ci.staying_all_services = true AND ci.service_slot_id IN (:...sameEvent))',
      { sameEvent: ['slot-2', 'slot-1'] },
    );
  });

  it('marks each waiting child once and tells only their guardians who can collect', async () => {
    const { processor, checkInRepo, push, gq, cq } = setup(
      [
        {
          id: 'ci1',
          child: {
            id: 'c1',
            firstname: 'Tobi',
            classGroup: { name: 'Preschool' },
          },
        },
        { id: 'ci2', child: { id: 'c2', firstname: 'Ife', classGroup: null } },
      ],
      [
        { childId: 'c1', memberId: 'p1' },
        { childId: 'c1', memberId: 'p2' },
      ],
    );
    expect(await processor.notify('slot-1')).toBe(2);
    expect(cq.andWhere).toHaveBeenCalledWith('ci.late_notified_at IS NULL');
    expect(checkInRepo.update).toHaveBeenCalledWith(expect.anything(), {
      lateNotifiedAt: expect.any(Date),
    });
    expect(gq.andWhere).toHaveBeenCalledWith('g.is_authorized_pickup = true');
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      ['p1', 'p2'],
      expect.objectContaining({
        key: PushNotificationKey.CHILD_LATE_PICKUP,
        idempotencyKey: 'cc-late:ci1',
        vars: { child_name: 'Tobi', room: 'Preschool' },
      }),
    );
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        vars: { child_name: 'Ife', room: "Children's Church" },
      }),
    );
  });
});
