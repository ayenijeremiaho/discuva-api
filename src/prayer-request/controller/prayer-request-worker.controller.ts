import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PrayerRequestService } from '../service/prayer-request.service';
import {
  SubmitPrayerRequestDto,
  SubmitTestimonyDto,
} from '../dto/prayer-request.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

@UseGuards(JwtAuthGuard)
@Controller()
export class PrayerRequestWorkerController {
  constructor(private readonly prayerRequestService: PrayerRequestService) {}

  @Post('prayer-requests')
  submitRequest(
    @Body() dto: SubmitPrayerRequestDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.prayerRequestService.submitRequest(dto, user);
  }

  @Get('prayer-requests/mine')
  getMyRequests(
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.prayerRequestService.getMyRequests(
      user.id,
      Number(page),
      Number(limit),
    );
  }

  @Post('testimonies')
  submitTestimony(
    @Body() dto: SubmitTestimonyDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.prayerRequestService.submitTestimony(dto, user);
  }

  @Get('testimonies/mine')
  getMyTestimonies(
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.prayerRequestService.getMyTestimonies(
      user.id,
      Number(page),
      Number(limit),
    );
  }

  @Get('testimonies/public')
  getPublicTestimonies(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.prayerRequestService.getPublicTestimonies(
      Number(page),
      Number(limit),
    );
  }
}
