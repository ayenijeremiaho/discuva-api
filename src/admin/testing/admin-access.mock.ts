export const mockAdminAccess = {
  isOn: jest.fn().mockResolvedValue(false),
  isFormAccessOn: jest.fn().mockResolvedValue(false),
  assertEnabled: jest.fn().mockResolvedValue(undefined),
  assertFormAccessEnabled: jest.fn().mockResolvedValue(undefined),
  assertCanDelegate: jest.fn().mockResolvedValue(undefined),
  permissions: jest.fn(async (admin) => admin?.adminRole?.permissions ?? []),
  has: jest.fn(
    async (admin, permission) =>
      !!admin?.adminRole?.permissions?.includes(permission),
  ),
  filter: jest.fn(async (admins, permission) =>
    admins.filter((a) => a.adminRole?.permissions?.includes(permission)),
  ),
  describe: jest.fn(async (admin) => admin),
};
