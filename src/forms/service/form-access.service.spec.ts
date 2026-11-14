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
    assertEnabled: jest.fn().mockResolvedValue(undefined),
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
  return { service, grants, forms, fields, admins, access, audit };
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
    access.assertEnabled.mockRejectedValue(new Error('disabled'));
    await expect(service.assertResultAccess(actor, 'form-a')).rejects.toThrow(
      'disabled',
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
      'ADMIN_USER_UPDATED',
      expect.objectContaining({
        metadata: expect.objectContaining({ formAccessFrom: null }),
      }),
    );
  });
});
