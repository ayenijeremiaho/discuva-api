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
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { VolunteerService } from '../service/volunteer.service';

@RequiresModule('volunteering')
@RequiresPlan(PlanFeature.VOLUNTEER)
@UseGuards(JwtAuthGuard, ModuleEnabledGuard, PlanGuard)
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
