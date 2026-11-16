import { FormAccessService } from './form-access.service';
import { Admin } from '../../admin/entity/admin.entity';

const actor = {
  id: 'actor',
  isActive: true,
  member: { id: 'member-actor' },
} as Admin;
function setup() {
  const grants = {
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
  const forms = {
    existsBy: jest.fn().mockResolvedValue(true),
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'form-a', title: 'Responses', purpose: 'QUIZ' }),
  };
  const fields = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: 'question', label: 'Question', fieldType: 'TEXT', order: 0 },
      ]),
  };
  const admins = {
    findOne: jest.fn().mockResolvedValue({
      id: 'recipient',
      isActive: true,
      member: { id: 'recipient-member' },
    }),
  };
  const access = {
    assertFormAccessEnabled: jest.fn().mockResolvedValue(undefined),
    isFormAccessOn: jest.fn().mockResolvedValue(true),
    has: jest.fn().mockResolvedValue(false),
  };
  const owners = { assertCanChange: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn() };
  const service = new FormAccessService(
    grants as never,
    forms as never,
    fields as never,
    admins as never,
    access as never,
    owners as never,
    audit as never,
  );
  return { service, grants, forms, fields, admins, access, audit, owners };
}
describe('FormAccessService', () => {
  it('requires a target-specific view grant without loading grants for global readers', async () => {
    const { service, grants, access } = setup();
    await expect(service.assertResultAccess(actor, 'form-b')).rejects.toThrow(
      'not found',
    );
    expect(grants.findOne).toHaveBeenCalledWith({
      where: { formId: 'form-b', adminId: 'actor', canView: true },
      select: { canExport: true },
    });
    grants.findOne.mockClear();
    access.has.mockResolvedValue(true);
    await service.assertResultAccess(actor, 'form-b');
    expect(grants.findOne).not.toHaveBeenCalled();
  });
  it('requires export as well as view and observes revoke on next request', async () => {
    const { service, grants } = setup();
    grants.findOne
      .mockResolvedValueOnce({ canExport: true })
      .mockResolvedValueOnce(null);
    await service.assertResultAccess(actor, 'form-a', 'export');
    expect(grants.findOne).toHaveBeenCalledWith({
      where: {
        formId: 'form-a',
        adminId: 'actor',
        canView: true,
        canExport: true,
      },
      select: { canExport: true },
    });
    await expect(
      service.assertResultAccess(actor, 'form-a', 'export'),
    ).rejects.toThrow();
  });
  it('denies inactive accounts and disabled feature grants', async () => {
    const { service, grants, access } = setup();
    await expect(
      service.assertResultAccess({ ...actor, isActive: false }, 'form-a'),
    ).rejects.toThrow();
    access.isFormAccessOn.mockResolvedValue(false);
    await expect(service.assertResultAccess(actor, 'form-a')).rejects.toThrow(
      'not enabled',
    );
    expect(grants.findOne).not.toHaveBeenCalled();
  });
  it('prevents results-only viewers from sharing and rejects export without view', async () => {
    const { service, grants, access } = setup();
    await expect(
      service.set(actor, 'form-a', 'recipient', {
        canView: true,
        canExport: false,
      }),
    ).rejects.toThrow('permissions');
    access.has.mockResolvedValue(true);
    await expect(
      service.set(actor, 'form-a', 'recipient', {
        canView: false,
        canExport: true,
      }),
    ).rejects.toThrow('View');
    expect(grants.upsert).not.toHaveBeenCalled();
  });
  it('protects own admin and owner targets and refuses missing tenant-local forms', async () => {
    const { service, admins, access, forms, grants } = setup();
    access.has.mockResolvedValue(true);
    admins.findOne.mockResolvedValue(actor);
    await expect(
      service.set(actor, 'form-a', 'actor', {
        canView: true,
        canExport: false,
      }),
    ).rejects.toThrow('own');
    admins.findOne.mockResolvedValue({ id: 'other' });
    forms.existsBy.mockResolvedValue(false);
    await expect(
      service.set(actor, 'foreign-form', 'other', {
        canView: true,
        canExport: false,
      }),
    ).rejects.toThrow('not found');
    expect(grants.upsert).not.toHaveBeenCalled();
  });
  it('returns only a safe field projection and export authority in results context', async () => {
    const { service, grants, fields } = setup();
    grants.findOne.mockResolvedValueOnce({ canExport: false });
    const result = await service.context(actor, 'form-a');
    expect(result.canExport).toBe(false);
    expect(fields.find.mock.calls[0][0].select).toEqual({
      id: true,
      label: true,
      fieldType: true,
      order: true,
    });
    expect(result).not.toHaveProperty('correctOptions');
  });
  it('upserts a unique grant and audits source and destination', async () => {
    const { service, access, grants, audit } = setup();
    access.has.mockResolvedValue(true);
    await service.set(actor, 'form-a', 'recipient', {
      canView: true,
      canExport: false,
    });
    expect(grants.upsert).toHaveBeenCalledWith(
      {
        formId: 'form-a',
        adminId: 'recipient',
        canView: true,
        canExport: false,
      },
      ['formId', 'adminId'],
    );
    expect(audit.log).toHaveBeenCalledWith(
      'FORM_ACCESS_GRANTED',
      expect.objectContaining({
        metadata: expect.objectContaining({ formAccessFrom: null }),
      }),
    );
  });

  describe('open and restricted forms', () => {
    const perms = (granted: string[]) => async (_a: unknown, p: string) =>
      granted.includes(p);

    it('lets a role that views forms see an open form without looking up grants', async () => {
      const { service, forms, grants, access } = setup();
      access.has.mockImplementation(perms(['forms:read']));
      forms.findOne.mockResolvedValue({ id: 'f', resultsAccess: 'OPEN' });
      await expect(service.assertResultAccess(actor, 'f')).resolves.toBe(true);
      expect(grants.findOne).not.toHaveBeenCalled();
    });

    it('keeps a restricted form to the people chosen on it, even from a role that views forms', async () => {
      const { service, forms, grants, access } = setup();
      access.has.mockImplementation(perms(['forms:read']));
      forms.findOne.mockResolvedValue({ id: 'f', resultsAccess: 'RESTRICTED' });
      await expect(service.assertResultAccess(actor, 'f')).rejects.toThrow(
        'not found',
      );
      grants.findOne.mockResolvedValue({ canExport: false });
      await expect(service.assertResultAccess(actor, 'f')).resolves.toBe(false);
    });

    it('always lets owners and form builders see a restricted form', async () => {
      const { service, forms } = setup();
      forms.findOne.mockResolvedValue({ id: 'f', resultsAccess: 'RESTRICTED' });
      await expect(
        service.assertResultAccess({ ...actor, isOwner: true }, 'f'),
      ).resolves.toBe(true);
      const builder = setup();
      builder.access.has.mockImplementation(perms(['forms:write']));
      await expect(
        builder.service.assertResultAccess(actor, 'f'),
      ).resolves.toBe(true);
    });

    it("keeps today's behaviour while assigned forms are off: role decides, restriction ignored", async () => {
      const { service, forms, access } = setup();
      access.isFormAccessOn.mockResolvedValue(false);
      access.has.mockImplementation(perms(['forms:read']));
      forms.findOne.mockResolvedValue({ id: 'f', resultsAccess: 'RESTRICTED' });
      await expect(service.assertResultAccess(actor, 'f')).resolves.toBe(true);
    });

    it('switches a form between open and restricted, for access managers only', async () => {
      const { service, forms, access } = setup();
      (forms as unknown as { update: jest.Mock }).update = jest.fn();
      await expect(
        service.setResultsAccess(actor, 'f', 'RESTRICTED' as never),
      ).rejects.toThrow('permissions');
      access.has.mockResolvedValue(true);
      await expect(
        service.setResultsAccess(actor, 'f', 'RESTRICTED' as never),
      ).resolves.toEqual({ resultsAccess: 'RESTRICTED' });
    });
  });

  describe('sharing several at once', () => {
    it('gives several people one form, or one person several forms, in a single write', async () => {
      const { service, forms, admins, access, grants } = setup();
      access.has.mockResolvedValue(true);
      (forms as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
      (admins as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockResolvedValue([
          { id: 'a1', isActive: true, member: { id: 'm1' } },
        ]);
      await expect(
        service.setMany(actor, ['f1', 'f2'], ['a1'], true),
      ).resolves.toEqual({ saved: 2 });
      expect(grants.upsert).toHaveBeenCalledTimes(1);
      expect(grants.upsert).toHaveBeenCalledWith(
        [
          { formId: 'f1', adminId: 'a1', canView: true, canExport: true },
          { formId: 'f2', adminId: 'a1', canView: true, canExport: true },
        ],
        ['formId', 'adminId'],
      );
    });

    it('refuses the whole save if one person is not an active admin, or is yourself', async () => {
      const { service, forms, admins, access, grants } = setup();
      access.has.mockResolvedValue(true);
      (forms as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockResolvedValue([{ id: 'f1' }]);
      (admins as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockResolvedValue([{ id: 'a1', isActive: true, member: {} }]);
      await expect(
        service.setMany(actor, ['f1'], ['a1', 'gone'], false),
      ).rejects.toThrow('Active admin not found');
      (admins as unknown as { find: jest.Mock }).find.mockResolvedValue([
        actor,
      ]);
      await expect(
        service.setMany(actor, ['f1'], ['actor'], false),
      ).rejects.toThrow('own');
      expect(grants.upsert).not.toHaveBeenCalled();
    });

    it('only an owner can share with an owner, checked without another lookup', async () => {
      const { service, forms, admins, access, owners } = setup();
      access.has.mockResolvedValue(true);
      (forms as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockResolvedValue([{ id: 'f1' }]);
      (admins as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockResolvedValue([{ id: 'o1', isActive: true, isOwner: true }]);
      await expect(
        service.setMany(actor, ['f1'], ['o1'], false),
      ).rejects.toThrow('owner');
      await expect(
        service.setMany({ ...actor, isOwner: true }, ['f1'], ['o1'], false),
      ).resolves.toEqual({ saved: 1 });
      expect(owners.assertCanChange).not.toHaveBeenCalled();
    });
  });
});
