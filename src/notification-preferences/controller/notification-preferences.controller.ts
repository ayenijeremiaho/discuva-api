import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { NotificationPreferencesService } from '../service/notification-preferences.service';
import { UpdateNotificationPreferenceDto } from '../dto/update-notification-preference.dto';

@UseGuards(JwtAuthGuard)
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  list(@CurrentUser() user: MemberAuth) {
    return this.preferences.list(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: MemberAuth,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.preferences.update(user.id, dto);
  }
}
