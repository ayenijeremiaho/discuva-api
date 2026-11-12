import { AdminController } from './admin.controller';

describe('AdminController.getMe', () => {
  const profile = () => ({
    id: 'a1',
    adminRole: {
      name: 'Owner',
      permissions: ['members:read', 'members:write', 'events:read'],
    },
  });
  const adminService = { getMyProfile: jest.fn(async () => profile()) };
  const tenantRepo = { exists: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  const controller = new AdminController(
    adminService as never,
    tenantRepo as never,
    cls as never,
  );

  it('keeps the full role at an open church', async () => {
    tenantRepo.exists.mockResolvedValue(false);
    const me = await controller.getMe({ id: 'a1' } as never);
    expect(me.adminRole.permissions).toContain('members:write');
  });

  it('shows only read permissions at a closed branch, so the portal hides its actions', async () => {
    tenantRepo.exists.mockResolvedValue(true);
    const me = await controller.getMe({ id: 'a1' } as never);
    expect(me.adminRole.permissions).toEqual(['members:read', 'events:read']);
  });

  it('returns an overseer as they are', async () => {
    const overseer = { id: 'ov', overseer: true };
    await expect(controller.getMe(overseer as never)).resolves.toBe(overseer);
    expect(adminService.getMyProfile).not.toHaveBeenCalledWith('ov');
  });
});
