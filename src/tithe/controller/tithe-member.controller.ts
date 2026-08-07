import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
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

  @Post('me/statement/send')
  emailStatement(
    @Request() req: any,
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string,
  ) {
    return this.titheService.emailTitheStatement(req.user, fromMonth, toMonth);
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

  @Get('proof')
  getMyProofs(
    @Request() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.titheService.getMyProofs(req.user, page, limit);
  }
}
