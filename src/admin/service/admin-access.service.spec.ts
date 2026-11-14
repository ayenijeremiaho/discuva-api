import { AdminAccessService } from './admin-access.service';
import { AdminPermission as P } from '../enum/admin-permission.enum';
import { Admin } from '../entity/admin.entity';

function setup(mode = 2, tenantId = 'tenant-a') {
  const settings = { getNumber: jest.fn().mockResolvedValue(mode) };
  const store = new Map<string, unknown>([['tenantId', tenantId]]);
  const cls = {
    isActive: () => true,
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
  };
  const config = { get: () => 'tenant-a,tenant-b' };
  const service = new AdminAccessService(
    settings as never,
    config as never,
    cls as never,
  );
  return { service, settings };
}
const admin = (role = [P.FORMS_READ], extra = [P.MEMBERS_READ]) =>
  ({
    isActive: true,
    adminRole: { permissions: role },
    additionalPermissions: extra,
  }) as Admin;

describe('AdminAccessService', () => {
  it('unions permissions without changing either source', async () => {
    const { service } = setup();
    const user = admin([P.FORMS_READ], [P.FORMS_READ, P.MEMBERS_READ]);
    expect(await service.permissions(user)).toEqual([
      P.FORMS_READ,
      P.MEMBERS_READ,
    ]);
    expect(user.adminRole.permissions).toEqual([P.FORMS_READ]);
    expect(user.additionalPermissions).toEqual([P.FORMS_READ, P.MEMBERS_READ]);
  });
  it('keeps role-authorised checks free of rollout-setting reads', async () => {
    const { service, settings } = setup();
    expect(await service.has(admin(), P.FORMS_READ)).toBe(true);
    expect(settings.getNumber).not.toHaveBeenCalled();
  });
  it('rejects grant editing while disabled', async () => {
    await expect(setup(0).service.assertEnabled()).rejects.toThrow(
      'not enabled',
    );
  });
  it('ignores direct grants with the switch off', async () => {
    expect(await setup(0).service.permissions(admin())).toEqual([P.FORMS_READ]);
  });
  it('allows only designated tenant IDs in test mode', async () => {
    expect(await setup(1).service.has(admin(), P.MEMBERS_READ)).toBe(true);
    expect(await setup(1, 'other').service.has(admin(), P.MEMBERS_READ)).toBe(
      false,
    );
  });
  it('memoises only the switch within a request, not user permissions', async () => {
    const { service, settings } = setup();
    const user = admin();
    expect(await service.has(user, P.MEMBERS_READ)).toBe(true);
    user.additionalPermissions = [];
    expect(await service.has(user, P.MEMBERS_READ)).toBe(false);
    expect(settings.getNumber).toHaveBeenCalledTimes(1);
  });
  it('denies inactive admins even with grants', async () => {
    expect(
      await setup().service.permissions({ ...admin(), isActive: false }),
    ).toEqual([]);
  });
  it('blocks delegation beyond authority and owner flag bypass without manage permission', async () => {
    const { service } = setup();
    await expect(
      service.assertCanDelegate(admin([P.ADMIN_WRITE], []), [P.FORMS_READ]),
    ).rejects.toThrow('already have');
    await expect(
      service.assertCanDelegate({ ...admin([], []), isOwner: true }, []),
    ).rejects.toThrow('management');
    await expect(
      service.assertCanDelegate(
        { ...admin([P.ADMIN_WRITE], []), isOwner: true },
        [P.FORMS_READ],
      ),
    ).resolves.toBeUndefined();
  });

  describe('individual permissions and assigned forms are switched separately', () => {
    const modes = (permissions: number, forms: number) => {
      const t = setup();
      t.settings.getNumber.mockImplementation(async (key: string) =>
        key === 'admin_access_mode' ? permissions : forms,
      );
      return t.service;
    };

    it('assigned forms work while individual permissions are off', async () => {
      const service = modes(0, 2);
      await expect(service.assertFormAccessEnabled()).resolves.toBeUndefined();
      await expect(service.assertEnabled()).rejects.toThrow(
        'Individual permissions are not enabled.',
      );
      const described = await service.describe(admin([], [P.MEMBERS_READ]));
      expect(described.formAccessEnabled).toBe(true);
      expect(described.accessGrantsEnabled).toBe(false);
      expect(described.effectivePermissions).toEqual([]);
    });

    it('individual permissions work while assigned forms are off', async () => {
      const service = modes(2, 0);
      await expect(service.assertFormAccessEnabled()).rejects.toThrow(
        'Assigned forms are not enabled.',
      );
      const described = await service.describe(admin([], [P.MEMBERS_READ]));
      expect(described.accessGrantsEnabled).toBe(true);
      expect(described.formAccessEnabled).toBe(false);
      expect(described.effectivePermissions).toEqual([P.MEMBERS_READ]);
    });
  });
});
