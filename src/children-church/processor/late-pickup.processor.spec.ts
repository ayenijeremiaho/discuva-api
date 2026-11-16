import { LatePickupProcessor } from './late-pickup.processor';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

function setup(waiting: unknown[], guardians: unknown[] = []) {
  const checkInRepo: any = {
    find: jest.fn().mockResolvedValue(waiting),
    update: jest.fn().mockResolvedValue({ affected: waiting.length }),
  };
  const gq: any = {};
  for (const m of ['select', 'addSelect', 'where', 'andWhere'])
    gq[m] = jest.fn(() => gq);
  gq.getRawMany = jest.fn().mockResolvedValue(guardians);
  const guardianRepo: any = { createQueryBuilder: jest.fn(() => gq) };
  const push: any = {
    dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new LatePickupProcessor(
    checkInRepo,
    guardianRepo,
    push,
    {} as any,
    {} as any,
  );
  return { processor, checkInRepo, push, gq };
}

describe('LatePickupProcessor', () => {
  it('does nothing when every child has been collected', async () => {
    const { processor, checkInRepo, push } = setup([]);
    expect(await processor.notify('slot-1')).toBe(0);
    expect(checkInRepo.update).not.toHaveBeenCalled();
    expect(push.dispatchToMemberIds).not.toHaveBeenCalled();
  });

  it('marks each waiting child once and tells only their guardians who can collect', async () => {
    const { processor, checkInRepo, push, gq } = setup(
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
    expect(checkInRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lateNotifiedAt: expect.anything() }),
      }),
    );
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
