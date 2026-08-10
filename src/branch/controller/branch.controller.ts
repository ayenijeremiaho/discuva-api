import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { BranchInviteService } from '../service/branch-invite.service';
import { BranchRollupService } from '../service/branch-rollup.service';
import { BranchLinkRequestService } from '../service/branch-link-request.service';
import { CreateBranchInviteDto } from '../dto/create-branch-invite.dto';
import { UpdateSharingConsentDto } from '../dto/update-sharing-consent.dto';
import { CreateBranchLinkRequestDto } from '../dto/create-branch-link-request.dto';

// Tenant-facing (AdminGuard) — a parent church's own admin sends/manages
// branch invites and views its branches' rollup stats; a branch's own admin
// controls what it shares and can leave the hierarchy unilaterally. See
// docs/MULTI_TENANT_MIGRATION.md §11 for the full design.
@UseGuards(AdminGuard)
@Controller('branch')
export class BranchController {
  constructor(
    private readonly branchInviteService: BranchInviteService,
    private readonly branchRollupService: BranchRollupService,
    private readonly branchLinkRequestService: BranchLinkRequestService,
  ) {}

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post('invites')
  createInvite(@Body() dto: CreateBranchInviteDto) {
    return this.branchInviteService.createInvite(dto.email, dto.sponsorPlan);
  }

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('invites')
  listInvites() {
    return this.branchInviteService.listInvites();
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Delete('invites/:id')
  revokeInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchInviteService.revokeInvite(id);
  }

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('overview')
  getOverview() {
    return this.branchRollupService.getOverview();
  }

  // Self-service — this tenant's own sharing preferences as a branch,
  // never settable by its parent.
  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('sharing-consent')
  getSharingConsent() {
    return this.branchRollupService.getSharingConsent();
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Patch('sharing-consent')
  updateSharingConsent(@Body() dto: UpdateSharingConsentDto) {
    return this.branchRollupService.updateSharingConsent(dto);
  }

  // Parent-initiated — detach one of this tenant's own branches.
  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Delete(':branchTenantId')
  unlinkBranch(@Param('branchTenantId', ParseUUIDPipe) branchTenantId: string) {
    return this.branchRollupService.unlinkBranch(branchTenantId);
  }

  // Branch-initiated — leave the current parent, if any.
  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post('leave')
  leaveParent() {
    return this.branchRollupService.leaveParent();
  }

  // Parent-initiated — request to link an already-onboarded, standalone
  // tenant as a branch (the invite flow above only covers a church that
  // doesn't have a tenant yet). Nothing changes until the target accepts.
  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post('link-requests')
  createLinkRequest(@Body() dto: CreateBranchLinkRequestDto) {
    return this.branchLinkRequestService.createLinkRequest(
      dto.targetSubdomain,
      dto.sponsorPlan,
    );
  }

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('link-requests/outgoing')
  listOutgoingLinkRequests() {
    return this.branchLinkRequestService.listOutgoing();
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Delete('link-requests/:id')
  revokeLinkRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchLinkRequestService.revokeLinkRequest(id);
  }

  // Target-side — requests sent TO this tenant by a would-be parent.
  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('link-requests/incoming')
  listIncomingLinkRequests() {
    return this.branchLinkRequestService.listIncoming();
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post('link-requests/:id/accept')
  acceptLinkRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchLinkRequestService.acceptLinkRequest(id);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post('link-requests/:id/decline')
  declineLinkRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchLinkRequestService.declineLinkRequest(id);
  }
}
