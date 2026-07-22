import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ConvertService } from '../service/convert.service';
import { CreateConvertDto } from '../dto/convert.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('evangelism')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller()
export class ConvertWorkerController {
  constructor(private readonly convertService: ConvertService) {}

  @Post('evangelism/converts')
  createConvert(
    @Body() dto: CreateConvertDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.convertService.createConvert(dto, user);
  }
}
