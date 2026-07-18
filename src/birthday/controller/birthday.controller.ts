import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { BirthdayService } from '../service/birthday.service';
import { SendWishDto } from '../dto/birthday-wish.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

@UseGuards(JwtAuthGuard)
@Controller('birthday')
export class BirthdayController {
  constructor(private readonly birthdayService: BirthdayService) {}

  @Get('today')
  getTodaysBirthdays(@CurrentUser() user: MemberAuth) {
    return this.birthdayService.getTodaysBirthdays(user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get('upcoming')
  getUpcomingBirthdays(@Query('days') days?: string) {
    return this.birthdayService.getUpcomingBirthdays(days ? Number(days) : 7);
  }

  @Post('wishes/:recipientId')
  sendWish(
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Body() dto: SendWishDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.birthdayService.sendWish(recipientId, user.id, dto.message);
  }

  @Get('wishes/me')
  getMyWishes(@CurrentUser() user: MemberAuth, @Query('year') year?: string) {
    return this.birthdayService.getWishesForMember(
      user.id,
      year ? Number(year) : undefined,
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get('wishes/:memberId')
  getMemberWishes(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Query('year') year?: string,
  ) {
    return this.birthdayService.getWishesForMember(
      memberId,
      year ? Number(year) : undefined,
    );
  }
}
