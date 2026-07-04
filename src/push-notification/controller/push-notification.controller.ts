import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { PushNotificationService } from '../service/push-notification.service';
import { SubscribePushDto } from '../dto/push-notification.dto';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class PushNotificationController {
  constructor(private readonly pushService: PushNotificationService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(@Req() req: any, @Body() dto: SubscribePushDto): Promise<void> {
    return this.pushService.subscribe(req.user.id, dto);
  }

  @Delete('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(@Req() req: any): Promise<void> {
    return this.pushService.unsubscribe(req.user.id);
  }
}
