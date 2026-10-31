import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AdminOwnerService } from './admin-owner.service';
import { Admin } from '../entity/admin.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

const execute = jest.fn();
const builder = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getCount: jest.fn(),
  execute,
};
const mockRepo = {
  createQueryBuilder: jest.fn(() => builder),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
  update: jest.fn(),
};
const mockTenants = { findOne: jest.fn() };
const mockEmail = { sendEmailWithTemplate: jest.fn() };
const mockAudit = { log: jest.fn() };

const admin = (over: object = {}) =>
  ({
    id: 'a1',
    isOwner: false,
    ownerInvitedAt: null,
    member: {
      id: 'm1',
      firstname: 'Ada',
      lastname: 'Obi',
      email: 'a@x.example',
    },
    ...over,
  }) as unknown as Admin;

describe('AdminOwnerService', () => {
  let service: AdminOwnerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepo.find.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        AdminOwnerService,
        { provide: getRepositoryToken(Admin), useValue: mockRepo },
        { provide: getRepositoryToken(Tenant), useValue: mockTenants },
        { provide: ClsService, useValue: { get: () => 't1' } },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: UtilityService, useValue: mockEmail },
      ],
    }).compile();
    service = module.get(AdminOwnerService);
  });

  it('lists owners and invites, and says when a second owner is required', async () => {
    builder.getMany.mockResolvedValue([
      admin({ isOwner: true }),
      admin({ id: 'a2', ownerInvitedAt: new Date() }),
    ]);
    mockTenants.findOne.mockResolvedValue({
      orgType: OrganisationTypeEnum.CHURCH,
    });

    const view = await service.list();

    expect(view.owners.map((o) => o.id)).toEqual(['a1']);
    expect(view.pendingInvites.map((o) => o.id)).toEqual(['a2']);
    expect(view.secondOwnerRequired).toBe(true);
  });

  it('only recommends a second owner for a small group', async () => {
    builder.getMany.mockResolvedValue([]);
    mockTenants.findOne.mockResolvedValue({
      orgType: OrganisationTypeEnum.GROUP,
    });
    expect((await service.list()).secondOwnerRequired).toBe(false);
  });

  it('invites another admin, without making them an owner yet', async () => {
    const target = admin({ id: 'a2' });
    mockRepo.findOne.mockResolvedValue(target);

    await service.invite(admin({ isOwner: true }), 'a2');

    expect(target.ownerInvitedAt).toBeInstanceOf(Date);
    expect(target.isOwner).toBe(false);
    expect(mockEmail.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
  });

  it("won't invite someone who is already an owner", async () => {
    mockRepo.findOne.mockResolvedValue(admin({ isOwner: true }));
    await expect(service.invite(admin(), 'a2')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('only someone invited can accept', async () => {
    await expect(service.accept(admin())).rejects.toThrow(BadRequestException);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it('accepting makes them an owner and tells the owners', async () => {
    mockRepo.find.mockResolvedValue([admin({ isOwner: true })]);
    await service.accept(admin({ ownerInvitedAt: new Date() }));
    expect(mockRepo.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ isOwner: true, ownerInvitedAt: null }),
    );
    expect(mockEmail.sendEmailWithTemplate).toHaveBeenCalled();
  });

  it('declining clears the invite', async () => {
    await service.decline(admin({ ownerInvitedAt: new Date() }));
    expect(mockRepo.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ ownerInvitedAt: null }),
    );
  });

  it('the last owner cannot step down', async () => {
    execute.mockResolvedValue({ affected: 0 });
    await expect(service.stepDown(admin({ isOwner: true }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('an owner can step down when another remains', async () => {
    execute.mockResolvedValue({ affected: 1 });
    await service.stepDown(admin({ isOwner: true }));
    expect(mockAudit.log).toHaveBeenCalledWith(
      'ADMIN_OWNER_STEPPED_DOWN',
      expect.anything(),
    );
  });

  describe('protecting owners', () => {
    it('a non-owner cannot change an owner', async () => {
      mockRepo.findOne.mockResolvedValue(admin({ id: 'a2' }));
      await expect(
        service.assertCanChange(admin({ isOwner: true }), 'm2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('an owner can change another owner', async () => {
      mockRepo.findOne.mockResolvedValue(admin({ id: 'a2', isOwner: true }));
      await expect(
        service.assertCanChange(admin({ isOwner: true }), 'm2'),
      ).resolves.toBeUndefined();
    });

    it('anyone with permission can change a non-owner', async () => {
      await expect(
        service.assertCanChange(admin(), 'm2'),
      ).resolves.toBeUndefined();
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('the last owner cannot be removed', async () => {
      builder.getCount.mockResolvedValue(0);
      await expect(
        service.assertNotLastOwner(admin({ isOwner: true })),
      ).rejects.toThrow(ConflictException);
    });
  });
});
