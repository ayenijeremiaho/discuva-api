import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { VolunteerService } from '../service/volunteer.service';

@RequiresModule('volunteering')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('volunteer-opportunities')
export class VolunteerController {
  constructor(private readonly volunteerService: VolunteerService) {}

  @Get()
  listOpen(
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: any,
  ) {
    return this.volunteerService.listOpen(
      page ? +page : 1,
      limit ? +limit : 20,
      req.user.id,
    );
  }

  @Post(':id/signup')
  @HttpCode(HttpStatus.OK)
  signUp(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.volunteerService.signUp(id, req.user.id);
  }

  @Delete(':id/signup')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelMySignUp(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.volunteerService.cancelMySignUp(id, req.user.id);
  }
}
