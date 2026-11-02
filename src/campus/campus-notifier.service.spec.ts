import { CampusNotifier } from './campus-notifier.service';
import { AdminPermission } from '../admin/enum/admin-permission.enum';
import { EmailCategory } from '../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../notification-catalogue/push-catalogue';

describe('CampusNotifier', () => {
  const admin = (
    id: string,
    email: string,
    perms = [AdminPermission.MEMBERS_WRITE],
  ) => ({
    id,
    member: { id: `m-${id}`, email },
    adminRole: { permissions: perms },
  });
  const adminRepo = { find: jest.fn() };
  const campusAdminRepo = { find: jest.fn() };
  const memberRepo = { findOne: jest.fn(), query: jest.fn() };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = new CampusNotifier(
    adminRepo as any,
    campusAdminRepo as any,
    memberRepo as any,
    notifications as any,
  );
  const notice = {
    requestId: 'r1',
    memberId: 'w1',
    fromCampus: { id: 'c1', name: 'North' },
    toCampus: { id: 'c2', name: 'South' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    adminRepo.find.mockResolvedValue([
      admin('north', 'north@x.test'),
      admin('south', 'south@x.test'),
      admin('wide', 'wide@x.test'),
      admin('reader', 'reader@x.test', [AdminPermission.MEMBERS_READ]),
    ]);
    campusAdminRepo.find.mockResolvedValue([
      { campusId: 'c1', adminId: 'north' },
      { campusId: 'c2', adminId: 'south' },
    ]);
    memberRepo.findOne.mockResolvedValue({
      id: 'w1',
      firstname: 'Fiona',
      lastname: 'Adeyemi',
      email: 'fiona@x.test',
    });
    memberRepo.query.mockResolvedValue([{ memberId: 'hod1' }]);
  });

  describe('choosing approvers', () => {
    it("picks the campus's own admins who manage members", async () => {
      expect(await notifier.adminsFor('c1')).toEqual([
        { memberId: 'm-north', email: 'north@x.test' },
      ]);
    });

    it('falls back to church-wide admins when a campus has none', async () => {
      expect(await notifier.adminsFor('c3')).toEqual([
        { memberId: 'm-wide', email: 'wide@x.test' },
      ]);
    });

    it('falls back to the owners when every admin looks after another campus', async () => {
      adminRepo.find.mockResolvedValue([
        admin('south', 'south@x.test'),
        { ...admin('owner', 'owner@x.test', []), isOwner: true },
      ]);
      expect(await notifier.adminsFor('c1')).toEqual([
        { memberId: 'm-owner', email: 'owner@x.test' },
      ]);
    });

    it('never asks the worker to approve their own move', async () => {
      campusAdminRepo.find.mockResolvedValue([
        { campusId: 'c1', adminId: 'north' },
      ]);
      memberRepo.findOne.mockResolvedValue({
        id: 'm-north',
        firstname: 'N',
        lastname: 'A',
        email: 'north@x.test',
      });
      memberRepo.query.mockResolvedValue([]);
      await notifier.moveRequested(notice);
      expect(notifications.notifyMember).not.toHaveBeenCalled();
    });

    it('skips the fallback when only the campus itself should hear', async () => {
      expect(await notifier.adminsFor('c3', true)).toEqual([]);
    });
  });

  it('asks the current campus to approve and tells department leads', async () => {
    await notifier.moveRequested(notice);
    expect(notifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        category: EmailCategory.CAMPUSES,
        email: expect.objectContaining({
          to: ['north@x.test'],
          template: 'campus-move-requested',
        }),
      }),
    );
    expect(notifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({
          memberIds: ['hod1'],
          key: PushNotificationKey.CAMPUS_MOVE_REQUESTED,
        }),
      }),
    );
  });

  it('tells the worker, the new campus and leads on approval', async () => {
    await notifier.moveDecided(notice, true);
    const calls = notifications.notifyMember.mock.calls.map((c) => c[0]);
    expect(calls[0].email).toMatchObject({
      to: 'fiona@x.test',
      template: 'campus-move-decided',
      data: expect.objectContaining({ decision: 'approved' }),
    });
    expect(calls[0].push.key).toBe(PushNotificationKey.CAMPUS_MOVE_APPROVED);
    expect(calls[1].email).toMatchObject({
      to: ['south@x.test'],
      template: 'campus-worker-joining',
    });
    expect(calls[2].push.key).toBe(PushNotificationKey.CAMPUS_WORKER_MOVED);
  });

  it('tells only the worker when declined', async () => {
    await notifier.moveDecided(notice, false);
    expect(notifications.notifyMember).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMember.mock.calls[0][0].push.key).toBe(
      PushNotificationKey.CAMPUS_MOVE_DECLINED,
    );
  });

  it('never fails the request when a lookup fails', async () => {
    adminRepo.find.mockRejectedValue(new Error('db down'));
    await expect(notifier.moveRequested(notice)).resolves.toBeUndefined();
  });
});
