import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MyWeekService } from '../service/my-week.service';

@UseGuards(JwtAuthGuard)
@Controller('my-week')
export class MyWeekController {
  constructor(private readonly myWeek: MyWeekService) {}

  @Get()
  get(@CurrentUser() user: MemberAuth) {
    return this.myWeek.forMember(user.id, user.workerProfileId);
  }
}
