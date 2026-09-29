import {
  Body,
  Controller,
  Delete,
  Get,
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

  // Clients subscribe with this key; a copy baked into the client drifted from the server's pair once.
  @Get('vapid-public-key')
  vapidPublicKey(): { publicKey: string } {
    return { publicKey: this.pushService.getPublicKey() };
  }

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
