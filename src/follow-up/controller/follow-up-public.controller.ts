import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { FollowUpService } from '../service/follow-up.service';
import { CreateFirstTimerDto } from '../dto/create-first-timer.dto';

// No login required — this is reached from the member app's signup screen
// before an account exists, by someone who may never create one at all
// (a visitor who just wants the church to know they're here). Mirrors
// FormPublicController's shape: @Public() + module gate, rate-limited since
// it's an open, unauthenticated write endpoint.
@Public()
@RequiresModule('follow_up')
@UseGuards(ModuleEnabledGuard)
@Controller('follow-up/public')
export class FollowUpPublicController {
  constructor(private readonly followUpService: FollowUpService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('first-timer')
  async selfOnboard(@Body() dto: CreateFirstTimerDto) {
    const firstTimer =
      await this.followUpService.createFirstTimerFromAppSignup(dto);
    return { received: true, firstTimerId: firstTimer.id };
  }

  // Defaults to today's events; ?search= is the fallback.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('events')
  async events(@Query('search') search?: string) {
    return this.followUpService.getPublicEvents(search);
  }
}
