import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ServiceRatingService } from '../service/service-rating.service';
import { SubmitServiceRatingDto } from '../dto/service-rating.dto';

@RequiresModule('service_ratings')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('service-ratings')
export class ServiceRatingController {
  constructor(private readonly serviceRatingService: ServiceRatingService) {}

  @Post()
  submitRating(@Body() dto: SubmitServiceRatingDto, @Request() req: any) {
    return this.serviceRatingService.submitRating(dto, req.user.id);
  }

  @Get('mine')
  getMyRating(
    @Query('eventId') eventId: string,
    @Query('serviceSlotId') serviceSlotId: string,
    @Request() req: any,
  ) {
    return this.serviceRatingService.getMyRating(
      eventId,
      serviceSlotId,
      req.user.id,
    );
  }
}
