import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { BranchHistoryService } from '../service/branch-history.service';

// Member app: read-only history at branches the person moved away from.
@UseGuards(JwtAuthGuard)
@Controller('network/history')
export class BranchHistoryController {
  constructor(private readonly history: BranchHistoryService) {}

  @Get()
  list(@Request() req: any) {
    this.assertMemberApp(req);
    return this.history.list(req.user.id);
  }

  @Get(':tenantId')
  detail(
    @Request() req: any,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    this.assertMemberApp(req);
    return this.history.detail(req.user.id, tenantId, year);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':tenantId/statement')
  statement(
    @Request() req: any,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string,
  ) {
    this.assertMemberApp(req);
    return this.history.emailStatement(
      req.user.id,
      tenantId,
      fromMonth,
      toMonth,
    );
  }

  private assertMemberApp(req: { user?: { surface?: SessionSurface } }) {
    if (req.user?.surface !== SessionSurface.MEMBER) {
      throw new ForbiddenException('Use the member app for this.');
    }
  }
}
