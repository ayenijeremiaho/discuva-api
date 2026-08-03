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
import { CreateBranchInviteDto } from '../dto/create-branch-invite.dto';
import { UpdateSharingConsentDto } from '../dto/update-sharing-consent.dto';

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
}
