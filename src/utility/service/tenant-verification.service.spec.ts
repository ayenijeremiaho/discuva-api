import { ForbiddenException } from '@nestjs/common';
import { TenantVerificationService } from './tenant-verification.service';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';

describe('TenantVerificationService private groups', () => {
  const repo = { findOne: jest.fn() };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
  };
  const settings = { getNumber: jest.fn().mockResolvedValue(50) };
  const service = new TenantVerificationService(
    repo as never,
    { get: jest.fn().mockReturnValue('t1') } as never,
    cache as never,
    settings as never,
  );
  const count = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    cache.getGlobal.mockResolvedValue(undefined);
  });

  const account = (orgType: OrganisationTypeEnum, verifiedAt: Date | null) =>
    repo.findOne.mockResolvedValue({ id: 't1', orgType, verifiedAt });

  it('stops a private group at its limit', async () => {
    account(OrganisationTypeEnum.GROUP, null);
    count.mockResolvedValue(50);
    await expect(service.assertRoomForMembers(count)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('counts everyone in an import before adding them', async () => {
    account(OrganisationTypeEnum.GROUP, null);
    count.mockResolvedValue(40);
    await expect(service.assertRoomForMembers(count, 11)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.assertRoomForMembers(count, 10),
    ).resolves.toBeUndefined();
  });

  it('never counts members for a verified group', async () => {
    account(OrganisationTypeEnum.GROUP, new Date());
    await service.assertRoomForMembers(count);
    expect(count).not.toHaveBeenCalled();
  });

  it('does not treat an unverified church as a private group', async () => {
    account(OrganisationTypeEnum.CHURCH, null);
    await expect(service.isPrivateGroup()).resolves.toBe(false);
  });

  it('blocks public actions for a private group', async () => {
    account(OrganisationTypeEnum.GROUP, null);
    await expect(service.assertNotPrivateGroup('publish')).rejects.toThrow(
      'verify your group',
    );
  });
});
