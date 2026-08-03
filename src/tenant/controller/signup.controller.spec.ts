import { Test, TestingModule } from '@nestjs/testing';
import { SignupController } from './signup.controller';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { BranchInviteService } from '../../branch/service/branch-invite.service';

const mockProvisioningService = { provision: jest.fn() };
const mockBranchInviteService = {
  resolveInvite: jest.fn(),
  markAccepted: jest.fn(),
};

const baseDto = {
  churchName: 'Test Church',
  subdomain: 'test-church',
  adminFirstname: 'Jane',
  adminLastname: 'Doe',
  adminEmail: 'jane@example.com',
  adminPassword: 'Password1!',
};

describe('SignupController', () => {
  let controller: SignupController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockProvisioningService.provision.mockResolvedValue({
      id: 'tenant-1',
      subdomain: 'test-church',
      name: 'Test Church',
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignupController],
      providers: [
        {
          provide: TenantProvisioningService,
          useValue: mockProvisioningService,
        },
        { provide: BranchInviteService, useValue: mockBranchInviteService },
      ],
    }).compile();
    controller = module.get(SignupController);
  });

  it('provisions a normal (non-branch) tenant with no parentTenantId', async () => {
    await controller.signup(baseDto);

    expect(mockBranchInviteService.resolveInvite).not.toHaveBeenCalled();
    expect(mockProvisioningService.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTenantId: undefined,
        sponsoredPlanId: undefined,
      }),
    );
    expect(mockBranchInviteService.markAccepted).not.toHaveBeenCalled();
  });

  it('resolves the invite token, provisions with parentTenantId, and marks the invite accepted', async () => {
    mockBranchInviteService.resolveInvite.mockResolvedValue({
      parentTenantId: 'parent-tenant-1',
      sponsoredPlanId: null,
    });

    await controller.signup({ ...baseDto, branchInviteToken: 'the-token' });

    expect(mockBranchInviteService.resolveInvite).toHaveBeenCalledWith(
      'the-token',
    );
    expect(mockProvisioningService.provision).toHaveBeenCalledWith(
      expect.objectContaining({ parentTenantId: 'parent-tenant-1' }),
    );
    expect(mockBranchInviteService.markAccepted).toHaveBeenCalledWith(
      'the-token',
      'tenant-1',
    );
  });

  it('passes sponsoredPlanId through to provisioning when the invite is sponsored', async () => {
    mockBranchInviteService.resolveInvite.mockResolvedValue({
      parentTenantId: 'parent-tenant-1',
      sponsoredPlanId: 'pro',
    });

    await controller.signup({ ...baseDto, branchInviteToken: 'the-token' });

    expect(mockProvisioningService.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTenantId: 'parent-tenant-1',
        sponsoredPlanId: 'pro',
      }),
    );
  });

  it('does not mark the invite accepted when provisioning itself fails', async () => {
    mockBranchInviteService.resolveInvite.mockResolvedValue({
      parentTenantId: 'parent-tenant-1',
      sponsoredPlanId: null,
    });
    mockProvisioningService.provision.mockRejectedValue(
      new Error('subdomain taken'),
    );

    await expect(
      controller.signup({ ...baseDto, branchInviteToken: 'the-token' }),
    ).rejects.toThrow('subdomain taken');
    expect(mockBranchInviteService.markAccepted).not.toHaveBeenCalled();
  });

  it('propagates an invalid/expired invite token as a signup failure before provisioning', async () => {
    mockBranchInviteService.resolveInvite.mockRejectedValue(
      new Error('Invalid or already-used invite code.'),
    );

    await expect(
      controller.signup({ ...baseDto, branchInviteToken: 'bad-token' }),
    ).rejects.toThrow('Invalid or already-used invite code.');
    expect(mockProvisioningService.provision).not.toHaveBeenCalled();
  });
});
