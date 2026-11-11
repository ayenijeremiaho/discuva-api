import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { NetworkTransferService } from '../service/network-transfer.service';
import { DeclineTransferDto, TransferRequestDto } from '../dto/network.dto';

@Controller('network/transfer')
export class NetworkTransferController {
  constructor(private readonly transfers: NetworkTransferService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  options(@Request() req: any) {
    this.assertMemberApp(req);
    return this.transfers.options(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post()
  request(@Request() req: any, @Body() dto: TransferRequestDto) {
    this.assertMemberApp(req);
    return this.transfers.request(req.user.id, dto.toTenantId);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  cancel(@Request() req: any) {
    this.assertMemberApp(req);
    return this.transfers.cancel(req.user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Get('requests')
  requests() {
    return this.transfers.pendingHere();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('requests/:id/release')
  release(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transfers.release(id, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('requests/:id/decline')
  decline(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineTransferDto,
  ) {
    return this.transfers.decline(id, user.id, dto.reason);
  }

  private assertMemberApp(req: { user?: { surface?: SessionSurface } }) {
    if (req.user?.surface !== SessionSurface.MEMBER) {
      throw new ForbiddenException('Use the member app for this.');
    }
  }
}
