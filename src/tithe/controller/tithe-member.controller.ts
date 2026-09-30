import {
  BadRequestException,
  Body,
  Controller,
  Get,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { TitheService } from '../service/tithe.service';
import { SubmitTitheProofDto } from '../dto/tithe.dto';
import { TitheProofStatus } from '../enum/tithe.enum';
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

const TITHE_PROOF_MAX_BYTES = 2 * 1024 * 1024;

@RequiresModule('tithe')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('tithes')
export class TitheMemberController {
  constructor(private readonly titheService: TitheService) {}

  @Get('accounts')
  getAccounts() {
    return this.titheService.getAccounts(true);
  }

  @Get('me')
  getMyTithes(
    @Request() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.titheService.getMyTithes(req.user, page, limit);
  }

  // Year's giving by type for the History tab; `years` lists the years with any giving.
  @Get('me/summary')
  getMySummary(
    @Request() req: any,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    if (year !== undefined && (year < 2000 || year > 2100)) {
      throw new BadRequestException('year must be between 2000 and 2100');
    }
    return this.titheService.getMyGivingSummary(req.user, year);
  }

  @Post('me/statement/send')
  emailStatement(
    @Request() req: any,
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string,
    @Query('givingOptionId', new ParseUUIDPipe({ optional: true }))
    givingOptionId?: string,
  ) {
    return this.titheService.emailGivingStatement(
      req.user,
      fromMonth,
      toMonth,
      givingOptionId,
    );
  }

  @Post('me/pledge-statement/send')
  emailPledgeStatement(@Request() req: any) {
    return this.titheService.emailPledgeContributionStatement(req.user);
  }

  @Post('proof')
  @UseInterceptors(LimitedFileInterceptor('file', TITHE_PROOF_MAX_BYTES))
  submitProof(
    @Request() req: any,
    @Body() dto: SubmitTitheProofDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.titheService.submitProof(req.user, dto, file);
  }

  // status: optional comma list (e.g. PENDING,DECLINED) — the History tab only needs proofs still awaiting action.
  @Get('proof')
  getMyProofs(
    @Request() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('status') status?: string,
  ) {
    const statuses = status
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const valid = Object.values(TitheProofStatus) as string[];
    if (statuses?.some((s) => !valid.includes(s))) {
      throw new BadRequestException(
        `status must be one or more of ${valid.join(', ')}`,
      );
    }
    return this.titheService.getMyProofs(
      req.user,
      page,
      limit,
      statuses as TitheProofStatus[] | undefined,
    );
  }
}
