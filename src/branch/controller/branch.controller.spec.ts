import { Test, TestingModule } from '@nestjs/testing';
import { BranchController } from './branch.controller';
import { BranchInviteService } from '../service/branch-invite.service';
import { BranchRollupService } from '../service/branch-rollup.service';
import { BranchLinkRequestService } from '../service/branch-link-request.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

const mockBranchInviteService = {
  createInvite: jest.fn(),
  listInvites: jest.fn(),
  revokeInvite: jest.fn(),
};
const mockBranchRollupService = {
  getOverview: jest.fn(),
  getSharingConsent: jest.fn(),
  updateSharingConsent: jest.fn(),
  unlinkBranch: jest.fn(),
  leaveParent: jest.fn(),
};
const mockBranchLinkRequestService = {
  createLinkRequest: jest.fn(),
  listOutgoing: jest.fn(),
  revokeLinkRequest: jest.fn(),
  listIncoming: jest.fn(),
  acceptLinkRequest: jest.fn(),
  declineLinkRequest: jest.fn(),
};

describe('BranchController', () => {
  let controller: BranchController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BranchController],
      providers: [
        { provide: BranchInviteService, useValue: mockBranchInviteService },
        { provide: BranchRollupService, useValue: mockBranchRollupService },
        {
          provide: BranchLinkRequestService,
          useValue: mockBranchLinkRequestService,
        },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(BranchController);
  });

  it('createInvite delegates to BranchInviteService', () => {
    controller.createInvite({ email: 'branch@example.com' });
    expect(mockBranchInviteService.createInvite).toHaveBeenCalledWith(
      'branch@example.com',
      undefined,
    );
  });

  it('createInvite passes sponsorPlan through', () => {
    controller.createInvite({
      email: 'branch@example.com',
      sponsorPlan: true,
    });
    expect(mockBranchInviteService.createInvite).toHaveBeenCalledWith(
      'branch@example.com',
      true,
    );
  });

  it('listInvites delegates to BranchInviteService', () => {
    controller.listInvites();
    expect(mockBranchInviteService.listInvites).toHaveBeenCalled();
  });

  it('revokeInvite delegates to BranchInviteService', () => {
    controller.revokeInvite('invite-1');
    expect(mockBranchInviteService.revokeInvite).toHaveBeenCalledWith(
      'invite-1',
    );
  });

  it('getOverview delegates to BranchRollupService', () => {
    controller.getOverview();
    expect(mockBranchRollupService.getOverview).toHaveBeenCalled();
  });

  it('getSharingConsent delegates to BranchRollupService', () => {
    controller.getSharingConsent();
    expect(mockBranchRollupService.getSharingConsent).toHaveBeenCalled();
  });

  it('updateSharingConsent delegates to BranchRollupService', () => {
    controller.updateSharingConsent({ shareGivingWithParent: true });
    expect(mockBranchRollupService.updateSharingConsent).toHaveBeenCalledWith({
      shareGivingWithParent: true,
    });
  });

  it('unlinkBranch delegates to BranchRollupService', () => {
    controller.unlinkBranch('branch-1');
    expect(mockBranchRollupService.unlinkBranch).toHaveBeenCalledWith(
      'branch-1',
    );
  });

  it('leaveParent delegates to BranchRollupService', () => {
    controller.leaveParent();
    expect(mockBranchRollupService.leaveParent).toHaveBeenCalled();
  });

  it('createLinkRequest delegates to BranchLinkRequestService', () => {
    controller.createLinkRequest({
      targetSubdomain: 'branchchurch',
      sponsorPlan: true,
    });
    expect(mockBranchLinkRequestService.createLinkRequest).toHaveBeenCalledWith(
      'branchchurch',
      true,
    );
  });

  it('listOutgoingLinkRequests delegates to BranchLinkRequestService', () => {
    controller.listOutgoingLinkRequests();
    expect(mockBranchLinkRequestService.listOutgoing).toHaveBeenCalled();
  });

  it('revokeLinkRequest delegates to BranchLinkRequestService', () => {
    controller.revokeLinkRequest('req-1');
    expect(mockBranchLinkRequestService.revokeLinkRequest).toHaveBeenCalledWith(
      'req-1',
    );
  });

  it('listIncomingLinkRequests delegates to BranchLinkRequestService', () => {
    controller.listIncomingLinkRequests();
    expect(mockBranchLinkRequestService.listIncoming).toHaveBeenCalled();
  });

  it('acceptLinkRequest delegates to BranchLinkRequestService', () => {
    controller.acceptLinkRequest('req-1');
    expect(mockBranchLinkRequestService.acceptLinkRequest).toHaveBeenCalledWith(
      'req-1',
    );
  });

  it('declineLinkRequest delegates to BranchLinkRequestService', () => {
    controller.declineLinkRequest('req-1');
    expect(
      mockBranchLinkRequestService.declineLinkRequest,
    ).toHaveBeenCalledWith('req-1');
  });
});
